#!/bin/sh
# Register a new box: generate ID + secret, store sha256(secret) in KV.
# Usage: registry/scripts/new-box.sh   (prints BOX_ID and BOX_SECRET once)
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
npx wrangler kv key put --binding BOXES "box:$ID" "$HASH" --remote
echo "BOX_ID=$ID"
echo "BOX_SECRET=$SECRET"
