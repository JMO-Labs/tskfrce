#!/system/bin/sh
# tor.sh [SECS=90]: start Orbot like a kid would (open it, tap Connect), then fetch through its SOCKS port.
# Pre-grants: notifications + VPN consent (appops ACTIVATE_VPN), so no system dialog needs a human.
# rc 0 = check.torproject.org says IsTor (Tor reached the internet), 1 = not within SECS.
K=/data/local/tmp/kit; SECS=${1:-90}; P=org.torproject.android
tor_ok() {
  B=$($K/curl -sS -m 8 --cacert $K/ca-bundle.crt --socks5-hostname 127.0.0.1:9050 https://check.torproject.org/api/ip 2>/dev/null)
  case "$B" in *'"IsTor":true'*) return 0 ;; esac
  return 1
}
tap_text() {  # tap the clickable node whose text is exactly $1; rc 1 if not on screen
  uiautomator dump /sdcard/tor-ui.xml >/dev/null 2>&1
  b=$(grep -oE "text=\"$1\"[^>]*clickable=\"true\"[^>]*bounds=\"[^\"]+\"" /sdcard/tor-ui.xml | grep -oE '\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]' | head -1)
  [ -n "$b" ] || return 1
  set -- $(echo "$b" | tr '[],' '   ')
  input tap $(( ($1 + $3) / 2 )) $(( ($2 + $4) / 2 ))
}
tor_ok && { echo "tor ok (already running)"; exit 0; }  # vpn.tor.running: connected before the pause
pm grant $P android.permission.POST_NOTIFICATIONS 2>/dev/null
appops set $P ACTIVATE_VPN allow
am start -n $P/.OrbotActivity >/dev/null 2>&1
sleep 4
tap_text Connect || echo "no Connect button (already connecting?)"
END=$(( $(date +%s) + SECS ))
while [ "$(date +%s)" -lt "$END" ]; do
  tor_ok && { echo "tor ok"; exit 0; }
  sleep 5
done
am force-stop $P  # a dead Orbot VPN would make the runner's Wi-Fi liveness check fail (false WIFI_LOST)
exit 1
