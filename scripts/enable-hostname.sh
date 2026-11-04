#!/bin/sh
# Turn on the <id>.taskfrce.jmolabs.dev HTTPS hostname for this box.
# Usage: enable-hostname.sh <box-id> <box-secret> [env-file=.env]
set -eu

[ $# -ge 2 ] || { echo "usage: $0 <box-id> <box-secret> [env-file]" >&2; exit 2; }
ID="$1" SECRET="$2" ENVF="${3:-.env}"

printf '%s' "$ID" | grep -Eq '^[a-z0-9]{6}$' || { echo "box id must be 6 chars [a-z0-9]" >&2; exit 1; }
printf '%s' "$SECRET" | grep -Eq '^[0-9a-fA-F]{64}$' || { echo "box secret must be 64 hex chars" >&2; exit 1; }

HOST="$ID.taskfrce.jmolabs.dev"
[ -f "$ENVF" ] || : >"$ENVF"

# edge appended to COMPOSE_PROFILES only if missing
PROFILES="$(sed -n 's/^COMPOSE_PROFILES=//p' "$ENVF" | tail -n 1)"
case ",$PROFILES," in
  *,edge,*) ;;
  *) PROFILES="${PROFILES:+$PROFILES,}edge" ;;
esac

# keep an existing non-empty EDGE_TOKEN, else generate one (never printed)
EDGE_TOKEN="$(sed -n 's/^EDGE_TOKEN=//p' "$ENVF" | tail -n 1)"
if [ -z "$EDGE_TOKEN" ]; then
  EDGE_TOKEN="$(openssl rand -hex 32 2>/dev/null || od -An -tx1 -N32 /dev/urandom | tr -d ' \n')"
fi

TMP="$(mktemp "$ENVF.XXXXXX")"
trap 'rm -f "$TMP"' EXIT
chmod 600 "$TMP"
grep -Ev '^(BOX_ID|BOX_SECRET|BOX_URL|NTFY_PUBLIC_URL|COMPOSE_PROFILES|EDGE_TOKEN)=' "$ENVF" >"$TMP" || true
{
  echo "BOX_ID=$ID"
  echo "BOX_SECRET=$SECRET"
  echo "BOX_URL=https://$HOST"
  echo "NTFY_PUBLIC_URL=https://$HOST:2443"
  echo "COMPOSE_PROFILES=$PROFILES"
  echo "EDGE_TOKEN=$EDGE_TOKEN"
} >>"$TMP"
mv "$TMP" "$ENVF"
trap - EXIT
echo "hostname https://$HOST enabled; restart with: docker compose -f docker-compose.prod.yml up -d"
