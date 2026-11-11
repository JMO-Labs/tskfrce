#!/bin/bash
# Setup mode captive portal: DNS spoofing + probe URL redirects.
# Runs while setup-mode flag is set.

set -e

SETUP_TRIGGER="/var/lib/tskfrce/setup-mode.active"
DNSMASQ_DROP_IN="/etc/NetworkManager/dnsmasq-shared.d/99-captive.conf"
HOTSPOT_IP="10.42.0.1"

log() { echo "[$(date +'%H:%M:%S')] $*" | systemd-cat -t tskfrce-captive -p info; }
err() { echo "[$(date +'%H:%M:%S')] ERROR: $*" | systemd-cat -t tskfrce-captive -p err; }

enable_captive_dns() {
  log "Enabling captive DNS: all queries -> $HOTSPOT_IP"
  mkdir -p "$(dirname "$DNSMASQ_DROP_IN")"
  cat >"$DNSMASQ_DROP_IN" <<EOF
# Captive portal: answer all DNS with hotspot IP
address=/#/$HOTSPOT_IP
EOF
  # Reload NetworkManager to apply
  nmcli general reload 2>/dev/null || systemctl reload NetworkManager || true
  log "Captive DNS enabled"
}

disable_captive_dns() {
  log "Disabling captive DNS"
  rm -f "$DNSMASQ_DROP_IN"
  nmcli general reload 2>/dev/null || systemctl reload NetworkManager || true
  log "Captive DNS disabled"
}

# Main: monitor setup-mode flag
while true; do
  if [ -f "$SETUP_TRIGGER" ]; then
    # Setup mode active
    if [ ! -f "$DNSMASQ_DROP_IN" ]; then
      enable_captive_dns
    fi
  else
    # Setup mode not active
    if [ -f "$DNSMASQ_DROP_IN" ]; then
      disable_captive_dns
    fi
  fi
  sleep 5
done
