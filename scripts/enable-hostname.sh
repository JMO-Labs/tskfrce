#!/bin/sh
# Turn on the <id>.taskfrce.jmolabs.dev HTTPS hostname for this box.
# Usage: enable-hostname.sh <box-id> <box-secret> [env-file=.env]
set -eu

[ $# -ge 2 ] || { echo "usage: $0 <box-id> <box-secret> [env-file]" >&2; exit 2; }
ID="$1" SECRET="$2" ENVF="${3:-$(dirname "$0")/../.env}"

case $ID in
  *[!a-z0-9]* | "") echo "box id must be 6 chars [a-z0-9]" >&2; exit 1 ;;
esac
[ ${#ID} -eq 6 ] || { echo "box id must be 6 chars [a-z0-9]" >&2; exit 1; }
case $SECRET in
  *[!0-9a-fA-F]* | "") echo "box secret must be 64 hex chars" >&2; exit 1 ;;
esac
[ ${#SECRET} -eq 64 ] || { echo "box secret must be 64 hex chars" >&2; exit 1; }

# optional sticker claim code: normalize (upper-case, drop '-'), validate before touching the file
CLAIM=""
if [ -n "${CLAIM_CODE:-}" ]; then
  CLAIM="$(printf %s "$CLAIM_CODE" | tr -d '-' | tr '[:lower:]' '[:upper:]')"
  case $CLAIM in
    *[!0-9A-HJKMNP-TV-Z]* | "") echo "CLAIM_CODE must be 10 chars (0-9, A-Z without I L O U)" >&2; exit 1 ;;
  esac
  [ ${#CLAIM} -eq 10 ] || { echo "CLAIM_CODE must be 10 chars (0-9, A-Z without I L O U)" >&2; exit 1; }
fi

[ -n "$CLAIM" ] || echo "warning: no CLAIM_CODE set; the first person on your home network can run setup. Finish setup right after installing." >&2

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
DROP='BOX_ID|BOX_SECRET|BOX_URL|COMPOSE_PROFILES|EDGE_TOKEN'
[ -z "$CLAIM" ] || DROP="$DROP|CLAIM_CODE"
grep -Ev "^($DROP)=" "$ENVF" >"$TMP" || true
{
  echo "BOX_ID=$ID"
  echo "BOX_SECRET=$SECRET"
  echo "BOX_URL=https://$HOST"
  echo "COMPOSE_PROFILES=$PROFILES"
  echo "EDGE_TOKEN=$EDGE_TOKEN"
  [ -z "$CLAIM" ] || echo "CLAIM_CODE=$CLAIM"
} >>"$TMP"
chmod 600 "$ENVF" # before writing secrets
cat "$TMP" >"$ENVF" # in place: keeps owner/group of the existing file
echo "hostname https://$HOST enabled."
echo "Next: docker compose -f docker-compose.prod.yml up -d, wait ~2 minutes, then open https://$HOST on a phone on your Wi-Fi."
echo "If it doesn't load, see https://taskfrce.jmolabs.dev/find?id=$ID."
echo "To undo, remove BOX_ID, BOX_SECRET, EDGE_TOKEN, CLAIM_CODE and BOX_URL from .env and set BOX_URL back to http://<lan-ip>:3000."
