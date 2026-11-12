#!/usr/bin/env bash
# Idempotent: push static x86_64 probe binaries to the Android emulator (/data/local/tmp/kit).
# Needs the droidns sudo helper. Binaries are cached in $KIT_CACHE (default: a fresh mktemp dir).
set -euo pipefail
ADB=(sudo -n /usr/local/sbin/droidns run /home/user/Android/Sdk/platform-tools/adb)
CURL_REL=8.23.0-1 # stunnel/static-curl: HTTP/3, ECH, c-ares
Q_REL=0.19.12     # natesales/q: DoT/DoH/DoQ client
DST=/data/local/tmp/kit
W=${KIT_CACHE:-$(mktemp -d)}
mkdir -p "$W" && cd "$W"

[ -x curl ] || {
  curl -fsSL "https://github.com/stunnel/static-curl/releases/download/$CURL_REL/curl-linux-x86_64-musl-$CURL_REL.tar.xz" | tar -xJ curl
}
[ -x q ] || {
  curl -fsSL "https://github.com/natesales/q/releases/download/v$Q_REL/q_${Q_REL}_linux_amd64.tar.gz" | tar -xz q
}
[ -s ca-bundle.crt ] || curl -fsSL -o ca-bundle.crt https://curl.se/ca/cacert.pem

# real.sh URL EXPECT [curl args]: exit 0 only if TLS validated (own CA bundle) and body has EXPECT.
cat >real.sh <<'EOS'
#!/system/bin/sh
# Static curl has no Android resolver: resolve with the system one (ping, bionic) and pin the IP.
K=/data/local/tmp/kit
URL=$1; EXPECT=$2; shift 2
H=${URL#*://}; H=${H%%/*}; H=${H%%:*}
case "$H" in
*[!0-9.]*)
  IP=$(ping -c1 -W3 "$H" 2>/dev/null | sed -n 's/^PING [^(]*(\([0-9.]*\)).*/\1/p')
  [ -n "$IP" ] || exit 1
  set -- --resolve "$H:443:$IP" --resolve "$H:80:$IP" "$@" ;;
esac
BODY=$($K/curl --cacert $K/ca-bundle.crt -sS -m 10 "$@" "$URL" 2>/dev/null) || exit 1
case "$BODY" in *"$EXPECT"*) exit 0 ;; *) exit 1 ;; esac
EOS

# gate.sh budget|yt: parallel fetches through Google's front end; count authentic bytes.
# rc 0 = full pages (>=50 KB), 3 = some real bytes (printed on the last line), 1 = nothing.
cat >gate.sh <<'EOS'
#!/system/bin/sh
K=/data/local/tmp/kit
MODE=$1
IP=$(ping -c1 -W3 www.google.com 2>/dev/null | sed -n 's/^PING [^(]*(\([0-9.]*\)).*/\1/p')
[ -n "$IP" ] || exit 1
rm -f /data/local/tmp/g.*.out
N=20; EXPECT=Google
case "$MODE" in
budget) URL="https://www.google.com/search?q=test"; HOST=www.google.com ;;
yt) URL="https://www.google.com/"; HOST=www.youtube.com; EXPECT=YouTube; N=3 ;;
esac
i=0
while [ $i -lt $N ]; do
  $K/curl --cacert $K/ca-bundle.crt --resolve "www.google.com:443:$IP" -H "Host: $HOST" \
    -sS -m 15 -o /data/local/tmp/g.$i.out "$URL" >/dev/null 2>&1 &
  i=$((i+1))
done
wait
B=0
for f in /data/local/tmp/g.*.out; do
  grep -q "$EXPECT" "$f" 2>/dev/null && B=$((B + $(wc -c <"$f")))
done
rm -f /data/local/tmp/g.*.out
echo "bytes=$B"
[ "$B" -ge 50000 ] && exit 0
[ "$B" -gt 0 ] && exit 3
exit 1
EOS

# longlived.sh start|check: a stream opened before the lock must stop growing after it.
cat >longlived.sh <<'EOS'
#!/system/bin/sh
K=/data/local/tmp/kit
F=/data/local/tmp/ll.out
case "$1" in
start)
  pkill -f speed.cloudflare 2>/dev/null; rm -f $F
  IP=$(ping -c1 -W3 speed.cloudflare.com 2>/dev/null | sed -n 's/^PING [^(]*(\([0-9.]*\)).*/\1/p')
  # ~100 KB/s keeps it alive for the whole run
  nohup $K/curl --cacert $K/ca-bundle.crt --resolve "speed.cloudflare.com:443:$IP" -sS \
    --limit-rate 100k -m 600 -o $F "https://speed.cloudflare.com/__down?bytes=60000000" \
    >/dev/null 2>&1 &
  sleep 3 ;;
check)
  A=$(wc -c <$F); sleep 5; B=$(wc -c <$F)
  echo "bytes=$A->$B"
  [ "$B" -gt "$A" ] ;;
stop) pkill -f speed.cloudflare 2>/dev/null; rm -f $F ;;
esac
EOS

"${ADB[@]}" root >/dev/null 2>&1 || true
"${ADB[@]}" wait-for-device
"${ADB[@]}" shell "mkdir -p $DST"
for f in curl q ca-bundle.crt real.sh gate.sh longlived.sh; do "${ADB[@]}" push "$f" "$DST/$f" >/dev/null; done
"${ADB[@]}" shell "chmod 755 $DST/curl $DST/q $DST/real.sh $DST/gate.sh $DST/longlived.sh"

echo "== versions on device =="
"${ADB[@]}" shell "$DST/curl --version | head -1; $DST/q --version 2>&1 | head -1"
"${ADB[@]}" shell "$DST/real.sh https://example.com 'Example Domain'; echo real.sh rc=\$?"
