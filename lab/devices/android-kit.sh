#!/usr/bin/env bash
# Idempotent: push static x86_64 probe binaries to the Android emulator (/data/local/tmp/kit).
# Needs the droidns sudo helper. Binaries are cached in $KIT_CACHE (default: a fresh mktemp dir).
set -euo pipefail
ADB=(sudo -n /usr/local/sbin/droidns run /home/user/Android/Sdk/platform-tools/adb)
CURL_REL=8.23.0-1 # stunnel/static-curl: HTTP/3, ECH, c-ares
Q_REL=0.19.12     # natesales/q: DoT/DoH/DoQ client
WS_REL=11.1.0     # erebe/wstunnel: WebSocket tunnel client (canary.ws)
SECRET_FILE=${CANARY_SECRET_FILE:-$HOME/.config/tskfrce-lab/canary.secret}
DST=/data/local/tmp/kit
W=${KIT_CACHE:-$(mktemp -d)}
mkdir -p "$W" && cd "$W"

[ -x curl ] || {
  curl -fsSL "https://github.com/stunnel/static-curl/releases/download/$CURL_REL/curl-linux-x86_64-musl-$CURL_REL.tar.xz" | tar -xJ curl
}
[ -x q ] || {
  curl -fsSL "https://github.com/natesales/q/releases/download/v$Q_REL/q_${Q_REL}_linux_amd64.tar.gz" | tar -xz q
}
[ -x wstunnel ] || {
  curl -fsSL "https://github.com/erebe/wstunnel/releases/download/v$WS_REL/wstunnel_${WS_REL}_linux_amd64.tar.gz" | tar -xz wstunnel
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

# gate.sh budget|yt. budget: for ~100 s fetch a Google suggest answer (Accept-Encoding: identity) and
# look for readable text we know it contains. yt: parallel fetches with a YouTube Host header.
# rc 0 = readable content (budget: marker found; yt: >=50 KB), 3 = only bytes (printed as bytes=N), 1 = nothing.
# Google's HTML search page is JS-gated for curl, so budget uses /complete/search (a plain-text API).
cat >gate.sh <<'EOS'
#!/system/bin/sh
K=/data/local/tmp/kit
MODE=$1
IP=$(ping -c1 -W3 www.google.com 2>/dev/null | sed -n 's/^PING [^(]*(\([0-9.]*\)).*/\1/p')
[ -n "$IP" ] || exit 1
rm -f /data/local/tmp/g.*.out
if [ "$MODE" = budget ]; then
  # query "zoroastrian calendar" always suggests "zoroastrian calendar converter"; the echoed query alone cannot match
  MARK='zoroastrian calendar converter'
  URL="https://www.google.com/complete/search?client=firefox&q=zoroastrian+calendar"
  END=$(( $(date +%s) + 100 )); B=0; n=0
  while [ "$(date +%s)" -lt $END ]; do
    n=$((n+1))
    S=$($K/curl --cacert $K/ca-bundle.crt --resolve "www.google.com:443:$IP" -H "Accept-Encoding: identity" \
      -sS -m 10 -o /data/local/tmp/g.0.out -w '%{size_download}' "$URL" 2>/dev/null)
    B=$((B + ${S:-0}))
    if grep -q "$MARK" /data/local/tmp/g.0.out 2>/dev/null; then
      rm -f /data/local/tmp/g.*.out; echo "readable after $n attempts bytes=$B"; exit 0
    fi
    sleep 3
  done
  rm -f /data/local/tmp/g.*.out
  echo "bytes=$B attempts=$n"
  [ "$B" -gt 0 ] && exit 3
  exit 1
fi
N=3; EXPECT=YouTube; URL="https://www.google.com/"; HOST=www.youtube.com
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

# canary.sh hit <transport> <token>: one hit on our locked-down canary. Exit 0 only if the reply is
# EXACTLY "canary:<token>" (a gate/portal reply cannot know the fresh token or the secret path).
# Transports: https h3 http80 ws alt:<port>. Every attempt is appended to /data/local/tmp/canary.log
# (transport token rc) so the host can confirm the canary's /seen/<token> after the run.
cat >canary.sh <<'EOS'
#!/system/bin/sh
K=/data/local/tmp/kit
H=canary.jmolabs.dev
[ "$1" = hit ] || exit 2
T=$2; TOK=$3
S=$(tr -d '\n' <$K/canary.secret) || exit 2
P=/$S/t/$TOK
IP=$(ping -c1 -W3 $H 2>/dev/null | sed -n 's/^PING [^(]*(\([0-9.]*\)).*/\1/p')
[ -n "$IP" ] || { echo "$T $TOK 1" >>/data/local/tmp/canary.log; exit 1; }
C="$K/curl --cacert $K/ca-bundle.crt -sS -m 12"
case "$T" in
https) R=$($C --resolve $H:443:$IP "https://$H$P" 2>/dev/null) ;;
h3) R=$($C --http3-only --resolve $H:443:$IP "https://$H$P" 2>/dev/null) ;;
alt:*) PT=${T#alt:}; R=$($C --resolve $H:$PT:$IP "https://$H:$PT$P" 2>/dev/null) ;;
http80)
  # CF answers :80 with a 301 to https; the Location carries the secret path, proof it is CF's edge
  L=$($C --resolve $H:80:$IP -o /dev/null -w '%{redirect_url}' "http://$H$P" 2>/dev/null)
  [ "$L" = "https://$H$P" ] && R=canary:$TOK ;;
ws)
  WI=$(ping -c1 -W3 tunnel.jmolabs.dev 2>/dev/null | sed -n 's/^PING [^(]*(\([0-9.]*\)).*/\1/p')
  [ -n "$WI" ] || { echo "$T $TOK 1" >>/data/local/tmp/canary.log; exit 1; }
  # IP in the URL (no resolv.conf on Android); SNI + Host name the tunnel (cert not verifiable by IP; trust = exact token reply)
  $K/wstunnel client -L tcp://127.0.0.1:18080:canary:8080 --http-upgrade-path-prefix "$S" \
    --tls-sni-override tunnel.jmolabs.dev -H "Host: tunnel.jmolabs.dev" \
    "wss://$WI:443" >/dev/null 2>&1 &
  WP=$!
  i=0; R=
  while [ $i -lt 8 ] && [ -z "$R" ]; do
    sleep 1
    R=$($K/curl -sS -m 6 "http://127.0.0.1:18080$P" 2>/dev/null)
    i=$((i+1))
  done
  kill $WP 2>/dev/null ;;
*) exit 2 ;;
esac
if [ "$R" = "canary:$TOK" ]; then RC=0; else RC=1; fi
echo "$T $TOK $RC" >>/data/local/tmp/canary.log
exit $RC
EOS

"${ADB[@]}" root >/dev/null 2>&1 || true
"${ADB[@]}" wait-for-device
"${ADB[@]}" shell "mkdir -p $DST"
for f in curl q wstunnel ca-bundle.crt real.sh gate.sh longlived.sh canary.sh; do "${ADB[@]}" push "$f" "$DST/$f" >/dev/null; done
"${ADB[@]}" shell "chmod 755 $DST/curl $DST/q $DST/real.sh $DST/gate.sh $DST/longlived.sh $DST/wstunnel $DST/canary.sh"

# canary secret: device-local file only, never printed (stdin push, no secret on any command line)
if [ -s "$SECRET_FILE" ]; then
  "${ADB[@]}" push "$SECRET_FILE" $DST/canary.secret >/dev/null
  "${ADB[@]}" shell "chmod 600 $DST/canary.secret"
else
  echo "no $SECRET_FILE: canary.sh will not work" >&2
fi

echo "== versions on device =="
"${ADB[@]}" shell "$DST/curl --version | head -1; $DST/q --version 2>&1 | head -1"
"${ADB[@]}" shell "$DST/real.sh https://example.com 'Example Domain'; echo real.sh rc=\$?"
