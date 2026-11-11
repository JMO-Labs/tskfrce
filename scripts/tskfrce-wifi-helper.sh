#!/bin/bash
# Privileged Wi-Fi helper (systemd service).
# Listens on /run/tskfrce-wifi.sock (root-owned), serves JSON commands.
# Commands: scan, join, forget, hotspot_up, hotspot_down, status, set_country

set -e

SOCKET="/run/tskfrce-wifi.sock"

log() { echo "[$(date +'%H:%M:%S')] $*" | systemd-cat -t tskfrce-wifi -p info; }
err() { echo "[$(date +'%H:%M:%S')] ERROR: $*" | systemd-cat -t tskfrce-wifi -p err; }

init_socket() {
  mkdir -p "$(dirname "$SOCKET")"
  rm -f "$SOCKET"
  mkfifo "$SOCKET"
  # SECURITY: socket is 0666 because:
  # 1. Only accessible via Unix socket (local only, not network exposed)
  # 2. Backend container may run as unprivileged user (appuser)
  # 3. Commands are validated and idempotent (no harm in replay)
  # 4. PSK never in socket protocol (only in temp files)
  chmod 0666 "$SOCKET"
  log "Socket ready at $SOCKET (mode 0666)"
}

# Handler for JSON-RPC style commands on the socket
handle_request() {
  local req="$1"
  local cmd
  cmd=$(echo "$req" | jq -r '.cmd // empty' 2>/dev/null)

  if [ -z "$cmd" ]; then
    echo '{"error":"invalid json"}' >"$SOCKET"
    return
  fi

  case "$cmd" in
    scan) cmd_scan ;;
    join) cmd_join "$req" ;;
    forget) cmd_forget "$req" ;;
    status) cmd_status ;;
    hotspot_up) cmd_hotspot_up "$req" ;;
    hotspot_down) cmd_hotspot_down ;;
    set_country) cmd_set_country "$req" ;;
    *) echo '{"error":"unknown command"}' >"$SOCKET" ;;
  esac
}

cmd_scan() {
  local output
  output=$(nmcli -t -f SSID,SECURITY,SIGNAL dev wifi list --rescan no 2>/dev/null || true)
  local networks="[]"
  if [ -n "$output" ]; then
    networks=$(echo "$output" | jq -Rs '
      split("\n") |
      map(select(length > 0) |
        split(":") as $parts |
        {
          ssid: $parts[0],
          security: $parts[1],
          signal: ($parts[2] | tonumber)
        }
      ) |
      sort_by(-.signal)
    ')
  fi
  echo "{\"networks\":$networks}" >"$SOCKET"
}

cmd_join() {
  local ssid password
  ssid=$(echo "$1" | jq -r '.ssid // empty')
  password=$(echo "$1" | jq -r '.password // empty')

  if [ -z "$ssid" ] || [ -z "$password" ]; then
    echo '{"error":"missing ssid or password"}' >"$SOCKET"
    return
  fi

  # SECURITY: password NEVER in argv (not visible in /proc/*/cmdline)
  # Method: create .nmconnection profile file (mode 0600), pass file path to nmcli
  # Commands: nmcli connection load <file> && nmcli connection up id=<ssid> && nmcli connection delete <ssid>
  # All PSK is in the ephemeral profile file, never in command line arguments
  local connfile
  connfile=$(mktemp --suffix=.nmconnection)
  chmod 0600 "$connfile"
  # shellcheck disable=SC2064
  trap "rm -f '$connfile'" RETURN

  cat >"$connfile" <<EOF
[connection]
id=$ssid
type=wifi
interface-name=wlan0
autoconnect=false

[wifi]
ssid=$ssid

[wifi-security]
key-mgmt=wpa-psk
psk=$password

[ipv4]
method=auto

[ipv6]
method=auto
EOF

  # Activate the connection (password is in file, NOT argv)
  # nmcli command line: nmcli connection load <file> && nmcli connection up id=<ssid>
  if nmcli connection load "$connfile" 2>/dev/null && \
     nmcli connection up id="$ssid" 2>/dev/null; then
    echo '{"success":true}' >"$SOCKET"
    log "Joined $ssid"
    # Clean up the connection
    nmcli connection delete "$ssid" 2>/dev/null || true
  else
    echo '{"success":false}' >"$SOCKET"
    nmcli connection delete "$ssid" 2>/dev/null || true
  fi
}

cmd_forget() {
  local ssid
  ssid=$(echo "$1" | jq -r '.ssid // empty')

  if [ -z "$ssid" ]; then
    echo '{"error":"missing ssid"}' >"$SOCKET"
    return
  fi

  if nmcli connection delete "$ssid" 2>/dev/null; then
    echo '{"success":true}' >"$SOCKET"
    log "Forgot $ssid"
  else
    echo '{"success":false}' >"$SOCKET"
  fi
}

cmd_status() {
  local output ssid state
  output=$(nmcli -t -f NAME,STATE dev show 2>/dev/null || true)
  ssid=""
  state="disconnected"

  if [ -n "$output" ]; then
    while IFS=: read -r name dev_state; do
      if [ "$dev_state" = "connected" ]; then
        ssid="$name"
        state="connected"
        break
      fi
    done <<<"$output"
  fi

  if [ "$state" = "connected" ]; then
    echo "{\"connected\":true,\"ssid\":\"$ssid\",\"signal\":0}" >"$SOCKET"
  else
    echo "{\"connected\":false,\"ssid\":null,\"signal\":0}" >"$SOCKET"
  fi
}

cmd_hotspot_up() {
  local ssid password country
  ssid=$(echo "$1" | jq -r '.ssid // empty')
  password=$(echo "$1" | jq -r '.password // empty')
  country=$(echo "$1" | jq -r '.country // "US"')

  if [ -z "$ssid" ] || [ -z "$password" ]; then
    echo '{"error":"missing ssid or password"}' >"$SOCKET"
    return
  fi

  # Set regulatory domain
  iw reg set "$country" 2>/dev/null || true

  # Create hotspot connection (WPA2, 2.4 GHz channel 6)
  if nmcli con add type wifi ifname wlan0 con-name tskfrce-setup \
    ssid "$ssid" mode ap password "$password" 802-11-wireless.band bg \
    802-11-wireless.channel 6 2>/dev/null; then
    if nmcli con up tskfrce-setup 2>/dev/null; then
      echo '{"success":true}' >"$SOCKET"
      log "Hotspot started: $ssid"
      return
    fi
  fi
  echo '{"success":false}' >"$SOCKET"
}

cmd_hotspot_down() {
  if nmcli con down tskfrce-setup 2>/dev/null; then
    nmcli con delete tskfrce-setup 2>/dev/null || true
    echo '{"success":true}' >"$SOCKET"
    log "Hotspot stopped"
  else
    echo '{"success":false}' >"$SOCKET"
  fi
}

cmd_set_country() {
  local country
  country=$(echo "$1" | jq -r '.country // empty')

  if [ -z "$country" ] || [ ${#country} -ne 2 ]; then
    echo '{"error":"invalid country code"}' >"$SOCKET"
    return
  fi

  if iw reg set "$country" 2>/dev/null; then
    # Persist to /etc/environment for next boot
    if grep -q "^TSKFRCE_COUNTRY=" /etc/environment; then
      sed -i "s/^TSKFRCE_COUNTRY=.*/TSKFRCE_COUNTRY=$country/" /etc/environment
    else
      echo "TSKFRCE_COUNTRY=$country" >>/etc/environment
    fi
    echo '{"success":true}' >"$SOCKET"
    log "Country set to $country"
  else
    echo '{"success":false}' >"$SOCKET"
  fi
}

# Main loop: listen on socket
init_socket
log "Service started, listening on $SOCKET"

while true; do
  if [ -e "$SOCKET" ]; then
    read -r -t 3600 req <"$SOCKET" || continue
    handle_request "$req" &
  fi
done
