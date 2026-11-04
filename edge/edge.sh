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
DATA_DIR=${DATA_DIR:-/data}
export BOX_ID BASE_DOMAIN
FQDN=$BOX_ID.$BASE_DOMAIN
CRT=$DATA_DIR/lego/certificates/$FQDN.crt

lan_ip() {
  ip -4 route get 1.1.1.1 | sed -n 's/.* src \([0-9.]*\).*/\1/p' | head -n 1
}

report_ip() {
  ip=$(lan_ip)
  [ -n "$ip" ] || return 1
  [ "$ip" = "$(cat "$DATA_DIR/last_ip" 2>/dev/null)" ] && return 0
  if curl -fsS -X POST -u "$BOX_ID:$BOX_SECRET" -H 'Content-Type: application/json' \
    -d "{\"ip\":\"$ip\"}" "$REGISTRY_URL/api/ip"; then
    mkdir -p "$DATA_DIR" && echo "$ip" > "$DATA_DIR/last_ip"
  else
    echo "report_ip failed" >&2
    return 1
  fi
}

# Returns 0 if the cert file changed.
issue_or_renew() {
  before=$(cksum "$CRT" 2>/dev/null)
  export HTTPREQ_ENDPOINT="$REGISTRY_URL/api/acme" HTTPREQ_USERNAME="$BOX_ID" HTTPREQ_PASSWORD="$BOX_SECRET"
  if [ -f "$CRT" ]; then act="renew --days 30"; else act=run; fi
  # shellcheck disable=SC2086 # act is an intentional word list
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
  b=30
  while [ ! -f "$CRT" ]; do
    report_ip
    issue_or_renew
    [ -f "$CRT" ] && break
    sleep "$b"
    b=$(next_backoff "$b")
  done
  caddy run --config /etc/caddy/Caddyfile &
  since=0
  while :; do
    sleep "$CHECK_SECS"
    report_ip
    since=$((since + CHECK_SECS))
    if [ "$since" -ge "$RENEW_SECS" ]; then
      since=0
      issue_or_renew && caddy reload --config /etc/caddy/Caddyfile --force
    fi
  done
}

if [ -n "${EDGE_ONCE:-}" ] && [ $# -gt 0 ]; then
  "$@"
else
  main
fi
