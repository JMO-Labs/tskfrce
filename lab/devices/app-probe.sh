#!/system/bin/sh
# app-probe.sh PKG [SECONDS=25] [MIN=300000] [URI]: launch an installed app and measure what it actually downloads.
# Oracle: per-UID rx bytes from the netd eBPF map (mAppUidStatsMap in `dumpsys netstats --full --uid`),
# live (no 2 h bucket lag). Scored on PAYLOAD = rxBytes - 60 * rxPackets: a paused app's retry storm through the
# SNI gate (SYN-ACK/ACK/FIN only, ~50 conn/s) adds ~700 KB of bare headers and no content.
# rc 0 = payload > MIN B (real content), 3 = 20000..MIN (bytes on last line), 1 = less.
# MIN per app = about half its unpaused payload: logged-out apps (no accounts on the lab phone) fetch far less than 300 KB.
# Screenshot of the final screen: /sdcard/escape-PKG.png (pull it to see what the kid sees).
PKG=$1; SECS=${2:-25}; MIN=${3:-300000}; URI=${4:-}
# URI: open a deep link (e.g. a video) instead of the launcher screen; logged-out home screens show no content
UID_=$(dumpsys package "$PKG" 2>/dev/null | sed -n 's/.*appId=\([0-9]*\).*/\1/p' | head -1)
[ -n "$UID_" ] || { echo "not installed: $PKG"; exit 2; }
rx() { dumpsys netstats --full --uid 2>/dev/null | awk -v u="$UID_" '/mAppUidStatsMap:/{f=1;next} /mStatsMapA:/{f=0} f&&$1==u{print $2 - 60 * $3; exit}'; }  # ponytail: 60 B = IPv4+TCP+timestamps; v6 headers are 20 B bigger
am force-stop "$PKG"; sleep 1
R0=$(rx); R0=${R0:-0}
pm grant "$PKG" android.permission.POST_NOTIFICATIONS 2>/dev/null  # no "allow notifications?" dialog over the content
if [ -n "$URI" ]; then am start -a android.intent.action.VIEW -d "$URI" -p "$PKG" >/dev/null 2>&1
else monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1; fi
sleep "$SECS"
input swipe 540 1700 540 700 300; sleep 3
input swipe 540 1700 540 700 300; sleep 3
screencap -p "/sdcard/escape-$PKG.png"
R1=$(rx); R1=${R1:-0}
D=$((R1 - R0))
echo "uid=$UID_ payload=$D"
[ "$D" -gt "$MIN" ] && exit 0
[ "$D" -ge 20000 ] && { echo "bytes=$D"; exit 3; }
exit 1
