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
  # SECURITY: socket 0660, owned by root:tskfrce-wifi group
  # Only backend service (via group_add in docker-compose) can connect
  chmod 0660 "$SOCKET"
  chgrp tskfrce-wifi "$SOCKET" 2>/dev/null || true
  log "Socket ready at $SOCKET (root:tskfrce-wifi 0660)"
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

  # SECURITY: Reject control chars (0x00-0x1f, 0x7f) in SSID and password
  # Prevents newline injection and other control-char attacks
  local ssid_clean password_clean
  ssid_clean=$(echo "$ssid" | tr -d '[:cntrl:]')
  password_clean=$(echo "$password" | tr -d '[:cntrl:]')

  if [ "$ssid_clean" != "$ssid" ]; then
    echo '{"error":"ssid contains control characters"}' >"$SOCKET"
    return
  fi
  if [ "$password_clean" != "$password" ]; then
    echo '{"error":"password contains control characters"}' >"$SOCKET"
    return
  fi

  # Create passwd-file (0600) with PSK - never in argv
  local passwdfile
  passwdfile=$(mktemp)
  chmod 0600 "$passwdfile"
  # shellcheck disable=SC2064
  trap "rm -f '$passwdfile'" RETURN

  echo "802-11-wireless-security.psk:$password" >"$passwdfile"

  # Use nmcli connection add (clean keyfile generation, no hand-built profile)
  # Then activate with passwd-file (PSK in file, not argv)
  if nmcli connection add type wifi con-name "$ssid" ifname wlan0 ssid "$ssid" \
    wifi-sec.key-mgmt wpa-psk 2>/dev/null && \
     nmcli connection up id "$ssid" passwd-file "$passwdfile" 2>/dev/null; then
    echo '{"success":true}' >"$SOCKET"
    log "Joined $ssid"
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
  local output ssid state hotspot_active
  output=$(nmcli -t -f NAME,STATE dev show 2>/dev/null || true)
  ssid=""
  state="disconnected"
  hotspot_active="false"

  if [ -n "$output" ]; then
    while IFS=: read -r name dev_state; do
      if [ "$dev_state" = "connected" ]; then
        ssid="$name"
        state="connected"
        break
      fi
    done <<<"$output"
  fi

  # Check if hotspot is active (flag file exists)
  if [ -f /var/lib/tskfrce/hotspot.active ]; then
    hotspot_active="true"
  fi

  if [ "$state" = "connected" ]; then
    echo "{\"connected\":true,\"ssid\":\"$ssid\",\"signal\":0,\"hotspot_active\":$hotspot_active}" >"$SOCKET"
  else
    echo "{\"connected\":false,\"ssid\":null,\"signal\":0,\"hotspot_active\":$hotspot_active}" >"$SOCKET"
  fi
}

cmd_hotspot_up() {
  local ssid password country passwdfile
  ssid=$(echo "$1" | jq -r '.ssid // empty')
  password=$(echo "$1" | jq -r '.password // empty')
  country=$(echo "$1" | jq -r '.country // "US"')

  if [ -z "$ssid" ] || [ -z "$password" ]; then
    echo '{"error":"missing ssid or password"}' >"$SOCKET"
    return
  fi

  # SECURITY: Reject control chars in SSID and password
  local ssid_clean password_clean
  ssid_clean=$(echo "$ssid" | tr -d '[:cntrl:]')
  password_clean=$(echo "$password" | tr -d '[:cntrl:]')

  if [ "$ssid_clean" != "$ssid" ]; then
    echo '{"error":"ssid contains control characters"}' >"$SOCKET"
    return
  fi
  if [ "$password_clean" != "$password" ]; then
    echo '{"error":"password contains control characters"}' >"$SOCKET"
    return
  fi

  # Set regulatory domain
  iw reg set "$country" 2>/dev/null || true

  # Create passwd-file (0600) for hotspot PSK
  passwdfile=$(mktemp)
  chmod 0600 "$passwdfile"
  # shellcheck disable=SC2064
  trap "rm -f '$passwdfile'" RETURN

  echo "802-11-wireless-security.psk:$password" >"$passwdfile"

  # Create hotspot connection (WPA2, 2.4 GHz channel 6) via nmcli connection add
  # PSK in passwd-file, NOT argv
  if nmcli connection add type wifi con-name tskfrce-setup ifname wlan0 \
    mode ap ssid "$ssid" wifi-sec.key-mgmt wpa-psk 802-11-wireless.band bg \
    802-11-wireless.channel 6 2>/dev/null && \
     nmcli connection up id tskfrce-setup passwd-file "$passwdfile" 2>/dev/null; then
    # Create hotspot.active flag (for backend to detect setup mode is active)
    mkdir -p /var/lib/tskfrce
    touch /var/lib/tskfrce/hotspot.active
    echo '{"success":true}' >"$SOCKET"
    log "Hotspot started: $ssid"
    return
  fi
  echo '{"success":false}' >"$SOCKET"
}

cmd_hotspot_down() {
  if nmcli con down tskfrce-setup 2>/dev/null; then
    nmcli con delete tskfrce-setup 2>/dev/null || true
    # Remove hotspot.active flag
    rm -f /var/lib/tskfrce/hotspot.active
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
