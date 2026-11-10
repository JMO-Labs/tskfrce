#!/bin/bash
# Tests edge.sh functions with stubbed curl/lego/caddy/ip.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin" "$T/data"
LOG=$T/log
for c in curl lego caddy; do
  # shellcheck disable=SC2016
  printf '#!/bin/sh\necho "%s $*" >> "%s"\necho "ENDPOINT=$HTTPREQ_ENDPOINT" >> "%s"\n' "$c" "$LOG" "$LOG" > "$T/bin/$c"
done
setip() { printf '#!/bin/sh\necho "1.1.1.1 via 192.168.1.1 dev eth0 src 192.168.1.%s uid 0"\n' "$1" > "$T/bin/ip"; }
chmod +x "$T/bin/"* 2>/dev/null
setip 40; chmod +x "$T/bin/ip"
export PATH="$T/bin:$PATH" DATA_DIR="$T/data" LAST_IP_FILE="$T/last_ip" BOX_ID=abc123 BOX_SECRET=s3cret EDGE_TOKEN=t EDGE_ONCE=1
fail=0
run() { sh "$HERE/edge.sh" "$@"; }
ok() { if [ "$2" = 0 ]; then echo "ok   $1"; else echo "FAIL $1"; fail=1; fi; }
has() { grep -qF -- "$1" "$LOG"; }

: > "$LOG"; run report_ip
has "/api/ip" && has "-u abc123:s3cret" && has '"ip":"192.168.1.40"'; ok "report_ip posts" $?
has " -4 " && has " -6 "; ok "report_ip makes -4 and -6 calls" $?

: > "$LOG"; run report_ip
r=0; [ ! -s "$LOG" ] || r=1; ok "same ip skips curl" $r

: > "$LOG"; run report_ip force
has '"ip":"192.168.1.40"'; ok "force reports despite same ip" $?

setip 41; : > "$LOG"; run report_ip
has '"ip":"192.168.1.41"'; ok "changed ip posts" $?

printf '#!/bin/sh\nexit 22\n' > "$T/bin/curl"; setip 42; : > "$LOG"; run report_ip
r=0; [ "$(cat "$T/last_ip")" = 192.168.1.41 ] || r=1; ok "failed report keeps last_ip" $r
printf '#!/bin/sh\necho "curl $*" >> "%s"\n' "$LOG" > "$T/bin/curl"

# -6 failing is ignored; -4 failing is not
printf '#!/bin/sh\ncase " $* " in *" -6 "*) exit 7;; esac\necho "curl $*" >> "%s"\n' "$LOG" > "$T/bin/curl"
setip 43; : > "$LOG"; run report_ip; r=$?
[ "$(cat "$T/last_ip")" = 192.168.1.43 ] || r=1; ok "failing -6 ignored, last_ip written" $r
printf '#!/bin/sh\necho "curl $*" >> "%s"\n' "$LOG" > "$T/bin/curl"

: > "$LOG"; run issue_or_renew
has "--path $T/data/lego" && has "--accept-tos" && has "--email boxes@jmolabs.dev" \
  && has "--server https://acme-v02.api.letsencrypt.org/directory" && has "--dns httpreq" && has "-d abc123.taskfrce.jmolabs.dev" && has " run" \
  && has "ENDPOINT=https://taskfrce.jmolabs.dev/api/acme"; ok "issue runs lego run" $?

mkdir -p "$T/data/lego/certificates"; echo c > "$T/data/lego/certificates/abc123.taskfrce.jmolabs.dev.crt"
: > "$LOG"; run issue_or_renew
has "renew --days 30"; ok "existing cert renews" $?

r=0; [ "$(run next_backoff 30)" = 60 ] && [ "$(run next_backoff 900)" = 900 ] || r=1; ok "next_backoff" $r

out=$(BOX_SECRET='' sh "$HERE/edge.sh" 2>&1); rc=$?
r=0; [ $rc -ne 0 ] && echo "$out" | grep -q "BOX_ID and BOX_SECRET are required" || r=1; ok "missing BOX_SECRET fails" $r

# failed report then retry posts again
printf '#!/bin/sh\nexit 22\n' > "$T/bin/curl"; setip 50; run report_ip 2>/dev/null
printf '#!/bin/sh\necho "curl $*" >> "%s"\n' "$LOG" > "$T/bin/curl"; : > "$LOG"; run report_ip
has '"ip":"192.168.1.50"'; r=$?; ok "retry after failed report posts" $r

# lego that writes the cert -> changed (0)
rm -rf "$T/data/lego"
printf '#!/bin/sh\nmkdir -p "%s/data/lego/certificates"; echo new > "%s/data/lego/certificates/abc123.taskfrce.jmolabs.dev.crt"\n' "$T" "$T" > "$T/bin/lego"
run issue_or_renew; r=$?; ok "issue_or_renew returns 0 when cert changed" $r
r=0; run issue_or_renew && r=1; ok "unchanged cert returns non-zero" $r

out=$(BOX_ID='' sh "$HERE/edge.sh" 2>&1); rc=$?
r=0; [ $rc -ne 0 ] && echo "$out" | grep -q "BOX_ID and BOX_SECRET are required" || r=1; ok "missing BOX_ID fails" $r
out=$(EDGE_TOKEN='' run next_backoff 30 2>&1)
r=0; echo "$out" | grep -q "EDGE_TOKEN not set" || r=1; ok "warns without EDGE_TOKEN" $r
out=$(EDGE_TOKEN=x run next_backoff 30 2>&1)
r=0; echo "$out" | grep -q "EDGE_TOKEN" && r=1; ok "no warning with EDGE_TOKEN" $r
r=0; ! grep -q 2443 "$HERE/Caddyfile" || r=1; ok "Caddyfile has no public ntfy port" $r
exit $fail
