#!/system/bin/sh
# app-probe.sh PKG [SECONDS=25]: launch an installed app and measure what it actually downloads.
# Oracle: per-UID rx bytes from the netd eBPF map (mAppUidStatsMap in `dumpsys netstats --full --uid`),
# live (no 2 h bucket lag). rc 0 = rx > 300000 B (real content), 3 = 20000..300000 (bytes on last line), 1 = less.
# Screenshot of the final screen: /sdcard/escape-PKG.png (pull it to see what the kid sees).
PKG=$1; SECS=${2:-25}
UID_=$(dumpsys package "$PKG" 2>/dev/null | sed -n 's/.*appId=\([0-9]*\).*/\1/p' | head -1)
[ -n "$UID_" ] || { echo "not installed: $PKG"; exit 2; }
rx() { dumpsys netstats --full --uid 2>/dev/null | awk -v u="$UID_" '/mAppUidStatsMap:/{f=1;next} /mStatsMapA:/{f=0} f&&$1==u{print $2; exit}'; }
am force-stop "$PKG"; sleep 1
R0=$(rx); R0=${R0:-0}
monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
sleep "$SECS"
input swipe 540 1700 540 700 300; sleep 3
input swipe 540 1700 540 700 300; sleep 3
screencap -p "/sdcard/escape-$PKG.png"
R1=$(rx); R1=${R1:-0}
D=$((R1 - R0))
echo "uid=$UID_ rx=$D"
[ "$D" -gt 300000 ] && exit 0
[ "$D" -ge 20000 ] && { echo "bytes=$D"; exit 3; }
exit 1
