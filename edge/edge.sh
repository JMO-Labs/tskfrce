#!/bin/sh
# t@sk4ce edge: reports LAN IP(s), keeps a Let's Encrypt cert fresh, runs Caddy.
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
LAST_IP_FILE=${LAST_IP_FILE:-/tmp/last_ip}
[ -n "${EDGE_TOKEN:-}" ] || echo "EDGE_TOKEN not set: kids' devices will not be told apart behind HTTPS" >&2
export BOX_ID BASE_DOMAIN
FQDN=$BOX_ID.$BASE_DOMAIN
CRT=$DATA_DIR/lego/certificates/$FQDN.crt

lan_ip() {
  ip -4 route get 1.1.1.1 | sed -n 's/.* src \([0-9.]*\).*/\1/p' | head -n 1
}

# collect_networks: outputs JSON {"networks":[{"ip":"...","label":"..."},...]}
collect_networks() {
  {
    echo "{\"networks\":["
    ip -o -4 addr show up 2>/dev/null | awk 'BEGIN { first=1 }
      {
        dev = $2; ip_line = $4
        split(ip_line, a, "/"); ip = a[1]

        if (dev ~ /^lo$|^docker|^br-|^veth|^virbr|^wg|^tailscale|^tun|^tap|^zt/) next

        split(ip, octets, ".")
        o1 = int(octets[1]); o2 = int(octets[2]); o3 = int(octets[3])

        is_private = 0
        if (o1 == 10) is_private = 1
        if (o1 == 172 && o2 >= 16 && o2 <= 31) is_private = 1
        if (o1 == 192 && o2 == 168) is_private = 1
        if (!is_private) next

        if (o1 == 10 && o2 == 42 && o3 == 0) next
        if (o1 == 169 && o2 == 254) next
        if (o1 == 100 && o2 >= 64 && o2 <= 127) next

        label = "Wired"
        if (dev ~ /\.[0-9]+$/) {
          gsub(/.*\./, "", dev)
          label = "VLAN " dev
        }
        gsub(/"/, "\\\"", label)

        if (!first) printf ","
        printf "{\"ip\":\"%s\",\"label\":\"%s\"}", ip, label
        first = 0
      }
    '
    echo "]}"
  }
}

# post_ip <curl family flag> <json_body>
post_ip() {
  curl "$1" -fsS --max-time 30 -X POST -u "$BOX_ID:$BOX_SECRET" -H 'Content-Type: application/json' \
    -d "$2" "$REGISTRY_URL/api/ip"
}

# report_ip [force]: -4 required, -6 best-effort
report_ip() {
  ip=$(lan_ip)
  [ -n "$ip" ] || return 1
  [ "${1:-}" = force ] || [ "$ip" != "$(cat "$LAST_IP_FILE" 2>/dev/null)" ] || return 0
  body="{\"ip\":\"$ip\"}"
  post_ip -6 "$body" >/dev/null 2>&1 || :
  if post_ip -4 "$body"; then
    echo "$ip" > "$LAST_IP_FILE"
  else
    echo "report_ip failed" >&2
    return 1
  fi
}

# Returns 0 if the cert file changed.
issue_or_renew() {
  before=$(cksum "$CRT" 2>/dev/null)

  # Build domain list for all possible networks (1-8): base + suffix -2 through -8
  # This ensures the cert covers all potential networks with SANs
  domains="-d $FQDN -d ${BOX_ID}-2.${BASE_DOMAIN} -d ${BOX_ID}-3.${BASE_DOMAIN} -d ${BOX_ID}-4.${BASE_DOMAIN} -d ${BOX_ID}-5.${BASE_DOMAIN} -d ${BOX_ID}-6.${BASE_DOMAIN} -d ${BOX_ID}-7.${BASE_DOMAIN} -d ${BOX_ID}-8.${BASE_DOMAIN}"

  # Determine action: renew if cert exists, else run (issue new)
  if [ -f "$CRT" ]; then act="renew --days 30"; else act="run"; fi

  # shellcheck disable=SC2086
  HTTPREQ_ENDPOINT="$REGISTRY_URL/api/acme" HTTPREQ_USERNAME="$BOX_ID" HTTPREQ_PASSWORD="$BOX_SECRET" \
    lego --path "$DATA_DIR/lego" --dns httpreq --accept-tos --email "$ACME_EMAIL" \
    --server "$LEGO_SERVER" $domains $act || echo "lego failed" >&2
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
