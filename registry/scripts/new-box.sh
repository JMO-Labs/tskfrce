#!/bin/sh
# Register a new box: generate ID + secret, store sha256(secret) in KV.
# Usage: registry/scripts/new-box.sh   (prints BOX_ID, BOX_SECRET, CLAIM_CODE, STICKER_QR2 once)
set -eu
cd "$(dirname "$0")/.."
ID=$(LC_ALL=C tr -dc 'a-z0-9' </dev/urandom | head -c 6)
SECRET=$(openssl rand -hex 32)
if command -v sha256sum >/dev/null 2>&1; then HASH=$(printf %s "$SECRET" | sha256sum)
elif command -v shasum >/dev/null 2>&1; then HASH=$(printf %s "$SECRET" | shasum -a 256)
else HASH=$(printf %s "$SECRET" | openssl dgst -sha256 -r); fi
HASH=${HASH%% *}
case $HASH in
  *[!0-9a-f]* | "") echo "bad hash" >&2; exit 1 ;;
esac
[ ${#HASH} -eq 64 ] || { echo "bad hash length" >&2; exit 1; }
# claim code stays on the box and sticker; never sent to the registry
CLAIM=$(LC_ALL=C tr -dc '0-9ABCDEFGHJKMNPQRSTVWXYZ' </dev/urandom | head -c 10)
[ ${#CLAIM} -eq 10 ] || { echo "bad claim code" >&2; exit 1; }
npx wrangler kv key put --binding BOXES "box:$ID" "$HASH" --remote
echo "BOX_ID=$ID"
echo "BOX_SECRET=$SECRET"
echo "CLAIM_CODE=$CLAIM"
echo "STICKER_QR2=https://$ID.taskfrce.jmolabs.dev/setup#claim=$CLAIM"
