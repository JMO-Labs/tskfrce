#!/bin/bash
# Check on boot if setup mode is needed.
# Setup mode is needed if: (no wired DHCP lease) AND (no saved Wi-Fi).

set -e

WIRED_IFACE="eno2"
SETUP_TRIGGER_FILE="/var/lib/tskfrce/setup-mode.active"

log() { echo "[$(date +'%H:%M:%S')] $*" | systemd-cat -t tskfrce-setup -p info; }
err() { echo "[$(date +'%H:%M:%S')] ERROR: $*" | systemd-cat -t tskfrce-setup -p err; }

# Check if wired has a DHCP lease
has_wired_lease() {
  ip -4 addr show dev "$WIRED_IFACE" 2>/dev/null | grep -q "inet " && return 0
  return 1
}

# Check if any saved Wi-Fi exists
has_saved_wifi() {
  nmcli -t -f NAME,TYPE connection show | grep -q "wifi" && return 0
  return 1
}

# Remove stale trigger file
rm -f "$SETUP_TRIGGER_FILE"

log "Checking if setup mode needed..."
log "  Wired lease? $(has_wired_lease && echo yes || echo no)"
log "  Saved Wi-Fi? $(has_saved_wifi && echo yes || echo no)"

if has_wired_lease; then
  log "Wired is connected, skipping setup mode"
  exit 0
fi

if has_saved_wifi; then
  log "Saved Wi-Fi exists, attempting to connect"
  # nmcli will auto-connect (or we can trigger it)
  exit 0
fi

# No wired, no saved Wi-Fi: enter setup mode
log "No network available, entering setup mode"
mkdir -p "$(dirname "$SETUP_TRIGGER_FILE")"
touch "$SETUP_TRIGGER_FILE"
systemctl start tskfrce-setup-mode || log "Setup mode service start requested"
