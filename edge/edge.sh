#!/bin/sh
# t@sk4ce edge: reports LAN IP, keeps a Let's Encrypt cert fresh, runs Caddy.
: "${BOX_ID:=}" "${BOX_SECRET:=}"
if [ -z "$BOX_ID" ] || [ -z "$BOX_SECRET" ]; then
  echo "BOX_ID and BOX_SECRET are required" >&2
  exit 1
fi
BASE_DOMAIN=${BASE_DOMAIN:-taskfrce.jmolabs.dev}
REGISTRY_URL=${REGISTRY_URL:-https://taskfrce.jmolabs.dev}
ACME_EMAIL=${ACME_EMAIL:-boxes@jmolabs.dev}
LEGO_SERVER=${LEGO_SERVER:-https://acme-v02.api.letsencrypt.org/directory}
CHECK_SECS=${CHECK_SECS:-300}
RENEW_SECS=${RENEW_SECS:-43200}
REPORT_EVERY_SECS=${REPORT_EVERY_SECS:-3600}
DATA_DIR=${DATA_DIR:-/data}
LAST_IP_FILE=${LAST_IP_FILE:-/tmp/last_ip} # non-persistent: every container start reports
[ -n "${EDGE_TOKEN:-}" ] || echo "EDGE_TOKEN not set: kids' devices will not be told apart behind HTTPS" >&2
export BOX_ID BASE_DOMAIN
FQDN=$BOX_ID.$BASE_DOMAIN
CRT=$DATA_DIR/lego/certificates/$FQDN.crt

lan_ip() {
  ip -4 route get 1.1.1.1 | sed -n 's/.* src \([0-9.]*\).*/\1/p' | head -n 1
}

# post_ip <curl family flag> <ip>: returns country code from CF-IPCountry header
post_ip() {
  # Capture headers to extract CF-IPCountry
  curl "$1" -fsS --max-time 30 -X POST -u "$BOX_ID:$BOX_SECRET" -H 'Content-Type: application/json' \
    -D /tmp/curl_headers_$$ \
    -d "{\"ip\":\"$2\"}" "$REGISTRY_URL/api/ip"
  # Extract CF-IPCountry from response headers (e.g., "CF-IPCountry: US")
  grep -i "^cf-ipcountry:" /tmp/curl_headers_$$ 2>/dev/null | cut -d: -f2 | tr -d ' \r' || true
  rm -f /tmp/curl_headers_$$
}

# report_ip [force]: -4 required, -6 best-effort (lets /find match IPv6-only visitors)
report_ip() {
  ip=$(lan_ip)
  [ -n "$ip" ] || return 1
  [ "${1:-}" = force ] || [ "$ip" != "$(cat "$LAST_IP_FILE" 2>/dev/null)" ] || return 0
  post_ip -6 "$ip" >/dev/null 2>&1 || :
  cc=$(post_ip -4 "$ip")
  if [ -n "$cc" ]; then
    echo "$ip" > "$LAST_IP_FILE"
    # Write country code for the box to pick up
    [ -d /data ] && echo "$cc" > /data/cf_country 2>/dev/null || true
  else
    echo "report_ip failed" >&2
    return 1
  fi
}

# Returns 0 if the cert file changed.
issue_or_renew() {
  before=$(cksum "$CRT" 2>/dev/null)
  if [ -f "$CRT" ]; then act="renew --days 30"; else act=run; fi
  # shellcheck disable=SC2086 # act is an intentional word list
  HTTPREQ_ENDPOINT="$REGISTRY_URL/api/acme" HTTPREQ_USERNAME="$BOX_ID" HTTPREQ_PASSWORD="$BOX_SECRET" \
    lego --path "$DATA_DIR/lego" --dns httpreq --accept-tos --email "$ACME_EMAIL" \
    --server "$LEGO_SERVER" -d "$FQDN" $act || echo "lego failed" >&2
  [ "$before" != "$(cksum "$CRT" 2>/dev/null)" ]
}

next_backoff() {
  n=$(($1 * 2))
  [ "$n" -gt 900 ] && n=900
  echo "$n"
}

main() {
  CADDY_PID=
  trap 'kill "$CADDY_PID" 2>/dev/null; exit 0' TERM INT
  b=30
  while [ ! -f "$CRT" ]; do
    report_ip
    issue_or_renew
    [ -f "$CRT" ] && break
    sleep "$b" & wait $!
    b=$(next_backoff "$b")
  done
  caddy run --config /etc/caddy/Caddyfile &
  CADDY_PID=$!
  # a cert may have expired while the box was off
  issue_or_renew && { caddy reload --config /etc/caddy/Caddyfile --force || exit 1; }
  since=0 reported=0
  while :; do
    sleep "$CHECK_SECS" & wait $!
    kill -0 "$CADDY_PID" || { echo "caddy exited" >&2; exit 1; }
    reported=$((reported + CHECK_SECS))
    if [ "$reported" -ge "$REPORT_EVERY_SECS" ]; then report_ip force && reported=0; else report_ip; fi
    since=$((since + CHECK_SECS))
    if [ "$since" -ge "$RENEW_SECS" ]; then
      since=0
      if issue_or_renew; then caddy reload --config /etc/caddy/Caddyfile --force || exit 1; fi
    fi
  done
}

if [ -n "${EDGE_ONCE:-}" ] && [ $# -gt 0 ]; then
  "$@"
else
  main
fi
