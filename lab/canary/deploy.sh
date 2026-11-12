#!/bin/sh
# Beast has no compose plugin: same hardening as docker-compose.yml, via plain docker.
# Run in /mnt/user/appdata/escape-canary (needs .env with CANARY_SECRET). NO published ports.
set -eu
. ./.env
NET=proxy_net
docker build -q -t escape-canary:local .
docker rm -f escape-canary escape-wstunnel >/dev/null 2>&1 || true
HARD="--read-only --cap-drop ALL --security-opt no-new-privileges:true --network $NET --restart unless-stopped --log-opt max-size=10m --log-opt max-file=7"
docker run -d --name escape-canary --network-alias canary $HARD --user 10001:10001 \
  -e CANARY_SECRET="$CANARY_SECRET" escape-canary:local
docker run -d --name escape-wstunnel --network-alias wstunnel $HARD --user 1000:1000 \
  --entrypoint /home/app/wstunnel ghcr.io/erebe/wstunnel:latest \
  server ws://0.0.0.0:8080 --restrict-to=canary:8080 \
  --restrict-http-upgrade-path-prefix="$CANARY_SECRET"
