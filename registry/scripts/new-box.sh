#!/bin/sh
# Register a new box: generate ID + secret, store sha256(secret) in KV.
# Usage: registry/scripts/new-box.sh   (prints BOX_ID and BOX_SECRET once)
set -eu
cd "$(dirname "$0")/.."
ID=$(LC_ALL=C tr -dc 'a-z0-9' </dev/urandom | head -c 6)
SECRET=$(openssl rand -hex 32)
HASH=$(printf %s "$SECRET" | sha256sum | cut -d' ' -f1)
npx wrangler kv key put --binding BOXES "box:$ID" "$HASH" --remote
echo "BOX_ID=$ID"
echo "BOX_SECRET=$SECRET"
