#!/bin/bash
# 5-minute Wi-Fi watchdog: if saved network unreachable, bring hotspot back.
# Runs as a systemd timer every 30 seconds.

set -e

SOCKET="/run/tskfrce-wifi.sock"
SETUP_TRIGGER="/var/lib/tskfrce/setup-mode.active"
LAST_ONLINE_FILE="/var/lib/tskfrce/wifi.last-online"
TIMEOUT=300  # 5 minutes

log() { echo "[$(date +'%H:%M:%S')] $*" | systemd-cat -t tskfrce-watchdog -p info; }

# Get current status
status=$(echo '{"cmd":"status"}' | nc -w 1 -U "$SOCKET" 2>/dev/null || echo '{}')
connected=$(echo "$status" | jq -r '.connected // false')

if [ "$connected" = "true" ]; then
  # Online, update last_online
  date +%s >"$LAST_ONLINE_FILE"
  [ -f "$SETUP_TRIGGER" ] && rm -f "$SETUP_TRIGGER"
  exit 0
fi

# Offline. Check how long
last_online=$(cat "$LAST_ONLINE_FILE" 2>/dev/null || date +%s)
now=$(date +%s)
elapsed=$((now - last_online))

log "Offline for ${elapsed}s (timeout ${TIMEOUT}s)"

if [ "$elapsed" -ge "$TIMEOUT" ] && [ ! -f "$SETUP_TRIGGER" ]; then
  log "5 minutes offline, starting setup hotspot"
  mkdir -p "$(dirname "$SETUP_TRIGGER")"
  touch "$SETUP_TRIGGER"
  systemctl start tskfrce-setup-mode 2>/dev/null || log "Setup mode start requested"
fi
