#!/usr/bin/env bash
# Run the stack under a hardware tier's caps and benchmark it. Project name task4ce-tier only.
# usage: scripts/tier.sh <pi4-2g|laptop-4g|pi3-1g|zero2w-512> <up|bench|soak N|gate|down> [--arm64]
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
P="$ROOT/perf"
TIER=${1:?tier}
CMD=${2:-gate}
shift 2 || true
MIN=""
ARCH=amd64
for a in "$@"; do
  case $a in
    --arm64) ARCH=arm64 ;;
    *) MIN=$a ;;
  esac
done
[ -f "$P/tiers/$TIER.env" ] || { echo "unknown tier $TIER" >&2; exit 2; }

mkdir -p "$P/results"
SECRETS="$P/results/.tier-env"
if [ ! -f "$SECRETS" ]; then
  (
    umask 077
    printf 'SECRET_KEY=%s\nINTERNAL_TOKEN=%s\n' "$(openssl rand -hex 32)" "$(openssl rand -hex 24)" >"$SECRETS"
  )
fi
INTERNAL_TOKEN=$(sed -n 's/^INTERNAL_TOKEN=//p' "$SECRETS")

if [ "$ARCH" = arm64 ]; then
  export TIER_IMAGE_PREFIX=ghcr.io/jmo-labs/tskfrce TIER_TAG=latest TIER_PLATFORM=linux/arm64
  # emulation: memory caps only, CPU is the host's
  export BACKEND_CPUS=16 FRONTEND_CPUS=16 BLOCKER_CPUS=16
  if [ ! -e /proc/sys/fs/binfmt_misc/qemu-aarch64 ]; then
    docker run --privileged --rm tonistiigi/binfmt --install arm64
  fi
fi

dc() {
  docker compose -p task4ce-tier -f "$P/docker-compose.tier.yml" \
    --env-file "$P/tiers/$TIER.env" --env-file "$SECRETS" "$@"
}

down() { dc down -v --remove-orphans; }

up() {
  down
  if [ "$ARCH" = arm64 ]; then dc pull; else dc build; fi
  local t0=$SECONDS
  dc up -d --no-build
  until curl -fs -o /dev/null http://127.0.0.1:18000/health &&
    curl -fs -o /dev/null http://127.0.0.1:13000/; do
    [ $((SECONDS - t0)) -lt 300 ] || { echo "startup timed out" >&2; dc logs --tail 30 >&2; exit 1; }
    sleep 0.5
  done
  echo $((SECONDS - t0)) >"$P/results/.startup-s"
  # the seed is a second Python process: lift the cap while it runs so it cannot OOM the backend
  local cid mem
  cid=$(dc ps -q backend)
  mem=$(docker inspect -f '{{.HostConfig.Memory}}' "$cid")
  docker update --memory 1g --memory-swap 1g "$cid" >/dev/null
  dc exec -T backend python -W ignore - <"$P/seed.py" | tail -n1 >"$P/results/.seed.json"
  docker update --memory "$mem" --memory-swap "$mem" "$cid" >/dev/null
}

bench() {
  python3 "$P/bench.py" --tier "$TIER" --arch "$ARCH" --internal-token "$INTERNAL_TOKEN" \
    --startup-s "$(cat "$P/results/.startup-s")" "$@"
}

case $CMD in
  up) up ;;
  bench) bench ;;
  soak) bench --soak "${MIN:?minutes}" ;;
  gate)
    trap down EXIT
    up
    bench --gate
    ;;
  down) down ;;
  *) echo "usage: $0 <tier> <up|bench|soak N|gate|down> [--arm64]" >&2; exit 2 ;;
esac
