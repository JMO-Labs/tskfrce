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
HDR_FILE=${HDR_FILE:-/tmp/ip_headers}
NET_TMP=${NET_TMP:-/tmp/lan_addrs}
[ -n "${EDGE_TOKEN:-}" ] || echo "EDGE_TOKEN not set: kids' devices will not be told apart behind HTTPS" >&2
export BOX_ID BASE_DOMAIN
FQDN=$BOX_ID.$BASE_DOMAIN
CRT=$DATA_DIR/lego/certificates/$FQDN.crt

lan_ip() {
  ip -4 route get 1.1.1.1 | sed -n 's/.* src \([0-9.]*\).*/\1/p' | head -n 1
}

# lan_devs: real home-network interfaces (spec A2): physical NICs and Wi-Fi, VLANs, bridges, bonds.
# Docker bridges, veths, loopback and VPNs never count. SYS_NET is overridable for tests.
lan_devs() {
  for d in "${SYS_NET:-/sys/class/net}"/*; do
    n=${d##*/}
    case $n in lo | docker* | br-* | veth* | virbr* | wg* | tailscale* | tun* | tap* | zt*) continue ;; esac
    if [ -e "$d/device" ] || [ -e "$d/bridge" ] || [ -e "$d/bonding" ]; then echo "$n"; continue; fi
    case $n in *.*) echo "$n" ;; esac
  done
}

# label_of <dev>: "VLAN <id>", the Wi-Fi SSID when iw is available, else "Wired"
label_of() {
  case $1 in *.*) echo "VLAN ${1##*.}"; return ;; esac
  ssid=$(iw dev "$1" link 2>/dev/null | sed -n 's/^[[:space:]]*SSID: //p' | tr -d '\042\134[:cntrl:]' | cut -c1-32) # strip JSON-breaking chars
  if [ -n "$ssid" ]; then echo "$ssid"; elif [ -e "${SYS_NET:-/sys/class/net}/$1/wireless" ]; then echo "Wi-Fi"; else echo "Wired"; fi
}

# collect_networks: {"networks":[{"ip":"...","label":"..."},...]} for every private LAN address (max 8)
collect_networks() {
  devs=" $(lan_devs | tr '\n' ' ') "
  out="" count=0
  # shellcheck disable=SC2034
  ip -o -4 addr show up 2>/dev/null | while read -r _ dev _ cidr _; do echo "$dev ${cidr%/*}"; done >"$NET_TMP"
  while read -r dev addr; do
    case $devs in *" $dev "*) ;; *) continue ;; esac
    case $addr in 10.42.0.*) continue ;; 10.*|192.168.*) ;; 172.1[6-9].*|172.2[0-9].*|172.3[01].*) ;; *) continue ;; esac
    [ "$count" -lt 8 ] || break
    label=$(label_of "$dev")
    out="$out${out:+,}{\"ip\":\"$addr\",\"label\":\"$label\"}"
    count=$((count + 1))
  done <"$NET_TMP"
  echo "{\"networks\":[$out]}"
}

# post_ip <curl family flag> <json body> [extra curl args]
post_ip() {
  fam=$1 body=$2
  shift 2
  curl "$fam" "$@" -fsS --max-time 30 -X POST -u "$BOX_ID:$BOX_SECRET" -H 'Content-Type: application/json' \
    -d "$body" "$REGISTRY_URL/api/ip"
}

# report_ip [force]: -4 required, -6 best-effort (lets /find match IPv6-only visitors)
report_ip() {
  body=$(collect_networks)
  case $body in *'"ip"'*) ;; *) return 1 ;; esac # no LAN address yet
  [ "${1:-}" = force ] || [ "$body" != "$(cat "$LAST_IP_FILE" 2>/dev/null)" ] || return 0
  post_ip -6 "$body" >/dev/null 2>&1 || :
  if post_ip -4 "$body" -D "$HDR_FILE"; then
    echo "$body" > "$LAST_IP_FILE"
    # Hand the Wi-Fi country (Cloudflare CF-IPCountry) to the host network daemon. Optional.
    cc=$(sed -n 's/^[Cc][Ff]-[Ii][Pp][Cc]ountry: *\([A-Za-z][A-Za-z]\).*/\1/p' "$HDR_FILE" 2>/dev/null | tr '[:lower:]' '[:upper:]')
    [ -n "$cc" ] && [ -d /tskfrce-host ] && echo "$cc" >/tskfrce-host/country || :
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
  # A cert issued before the 8-name SAN list must be re-issued once, not just renewed.
  SANS_MARK=$DATA_DIR/lego/sans-8
  if [ -f "$CRT" ] && [ -f "$SANS_MARK" ]; then act="renew --days 30"; else act="run"; fi

  # shellcheck disable=SC2086
  if HTTPREQ_ENDPOINT="$REGISTRY_URL/api/acme" HTTPREQ_USERNAME="$BOX_ID" HTTPREQ_PASSWORD="$BOX_SECRET" \
    lego --path "$DATA_DIR/lego" --dns httpreq --accept-tos --email "$ACME_EMAIL" \
    --server "$LEGO_SERVER" $domains $act; then
    mkdir -p "${SANS_MARK%/*}" && touch "$SANS_MARK"
  else
    echo "lego failed" >&2
  fi
  share_certs
  [ "$before" != "$(cksum "$CRT" 2>/dev/null)" ]
}

# share_certs: let the backend (non-root, edge_data mounted ro) read public certs for
# its cert.expiring suggestion. Private keys stay 0600.
share_certs() {
  d=$DATA_DIR/lego/certificates
  [ -d "$d" ] || return 0
  chmod 711 "$DATA_DIR/lego" && chmod 755 "$d"
  for f in "$d"/*.crt; do [ -f "$f" ] && chmod 644 "$f"; done
  return 0
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
