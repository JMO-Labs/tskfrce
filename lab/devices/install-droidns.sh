#!/usr/bin/env bash
# One-time root install for the Android lab netns helper. Run: sudo bash lab/devices/install-droidns.sh
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "run with sudo" >&2; exit 1; }
LAB_USER=user
HERE=$(cd "$(dirname "$0")" && pwd)
SRC_CONF=/home/$LAB_USER/.config/tskfrce-lab/wpa.conf

# earlier failed attempt may have left a directory at the target path
[ -d /usr/local/sbin/droidns ] && rm -r /usr/local/sbin/droidns
install -D -o root -g root -m 755 "$HERE/droidns" /usr/local/sbin/droidns

# Wi-Fi config must be root-owned: wpa_supplicant config can load shared libs
install -d -o root -g root -m 700 /etc/tskfrce-lab
if [ -f "$SRC_CONF" ]; then
  install -o root -g root -m 600 "$SRC_CONF" /etc/tskfrce-lab/wpa.conf
  rm -f "$SRC_CONF"
fi
[ -f /etc/tskfrce-lab/wpa.conf ] || { echo "missing /etc/tskfrce-lab/wpa.conf" >&2; exit 1; }

# dhcpcd config for droidns: client id from the current MAC (no persistent DUID linking identities)
cat >/etc/tskfrce-lab/dhcpcd.conf <<'EOF'
clientid
option domain_name_servers, domain_name, domain_search, host_name
option classless_static_routes, interface_mtu
require dhcp_server_identifier
nohook resolv.conf
EOF
chmod 644 /etc/tskfrce-lab/dhcpcd.conf

tmp=$(mktemp)
echo "$LAB_USER ALL=(root) NOPASSWD: /usr/local/sbin/droidns" >"$tmp"
visudo -cf "$tmp" >/dev/null
install -o root -g root -m 440 "$tmp" /etc/sudoers.d/droidns
rm -f "$tmp"

usermod -aG kvm "$LAB_USER"
echo "droidns installed. kvm group applies to new logins (or use: sg kvm -c ...)."
