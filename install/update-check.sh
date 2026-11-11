#!/bin/bash
# t@sk4ce unattended updater: nightly pull, verify all services, health check, rollback.
# Installed as systemd service + timer by install.sh.
# Updates the box unless: UPDATE_CHANNEL=off, or a kid session/timer is active.

set -eu

DIR="${TASK4CE_DIR:-$HOME/task4ce}"
ENV_FILE="$DIR/.env"
DIGESTS_FILE="$DIR/.digests.json"
LOG_FILE="$DIR/update-check.log"
COMPOSE_FILE="$DIR/docker-compose.prod.yml"

say() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*" | tee -a "$LOG_FILE"; }
die() { say "ERROR: $*"; exit 1; }

env_value() {
  sed -n "s/^$1=//p" "$ENV_FILE" | head -n 1 || echo ""
}

update_env() {
  local key="$1" value="$2"
  if grep -q "^$key=" "$ENV_FILE"; then
    sed -i "s/^$key=.*/$key=$value/" "$ENV_FILE"
  else
    echo "$key=$value" >>"$ENV_FILE"
  fi
}

# Check if kid session is active via backend internal API (fail closed)
kid_session_active() {
  local api_port response active
  api_port=$(env_value BACKEND_PORT | sed 's/.*://')
  api_port="${api_port:-8000}"
  local token
  token=$(env_value INTERNAL_TOKEN)
  [ -n "$token" ] || return 0  # No token: skip update (fail closed)

  response=$(curl -sf -H "Authorization: Bearer $token" \
    "http://127.0.0.1:$api_port/internal/kid-session-active" 2>/dev/null || echo "")
  [ -z "$response" ] && return 0  # Backend unreachable: skip update (fail closed)

  # Parse JSON: {"active": true/false}
  active=$(echo "$response" | grep -o '"active":\s*true' >/dev/null && echo "1" || echo "0")
  [ "$active" = "1" ]
}

# Verify image signature with cosign (keyless, GitHub OIDC)
# Identity pinned to JMO-Labs/tskfrce repo and CI workflow
verify_image() {
  local image="$1"
  say "Verifying image signature: $image"
  cosign verify \
    --certificate-identity-regexp '^https://github\.com/JMO-Labs/tskfrce/\.github/workflows/ci-cd\.yml@refs/(heads/main|tags/(v|eval-).*?)$' \
    --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
    "$image" >/dev/null 2>&1 ||
    die "Image signature verification failed: $image"
}

# Get image digest and verify
get_verified_digest() {
  local image="$1"
  verify_image "$image"
  docker inspect --format='{{index .RepoDigests 0}}' "$image" ||
    die "Could not get digest for $image"
}

# Send ntfy alert + Today note via backend API
alert_and_note() {
  local result="$1" version="$2" old_version="$3"
  local api_port ntfy_url token
  api_port=$(env_value BACKEND_PORT | sed 's/.*://')
  api_port="${api_port:-8000}"
  ntfy_url=$(env_value NTFY_PUBLIC_URL)
  token=$(env_value INTERNAL_TOKEN)

  [ -n "$token" ] || return 1

  if [ "$result" = "success" ]; then
    local note="Updated to $version"
  else
    local note="Update to $version failed, still on $old_version, will retry tomorrow"
  fi

  # Post Today note via internal API
  curl -sf -X POST -H "Authorization: Bearer $token" \
    -H "Content-Type: application/json" \
    -d "{\"note\":\"$note\"}" \
    "http://127.0.0.1:$api_port/internal/today-note" >/dev/null 2>&1 || true

  # For failed updates: send ntfy alert if configured
  if [ "$result" = "failed" ] && [ -n "$ntfy_url" ]; then
    curl -sf -d "Update failed: still on $old_version" "$ntfy_url/updates" >/dev/null 2>&1 || true
  fi

  # For eval channel failures: send telemetry
  local channel
  channel=$(env_value UPDATE_CHANNEL)
  if [ "$result" = "failed" ] && [ "$channel" = "eval" ]; then
    curl -sf -X POST -H "Authorization: Bearer $token" \
      -H "Content-Type: application/json" \
      -d '{"event":"update_failed"}' \
      "http://127.0.0.1:$api_port/internal/telemetry" >/dev/null 2>&1 || true
  fi
}

# Main updater logic
main() {
  say "=== Update check ==="

  local channel
  channel=$(env_value UPDATE_CHANNEL)
  if [ -z "$channel" ]; then
    say "UPDATE_CHANNEL not set; skipping"
    return 0
  fi

  if [ "$channel" = "off" ]; then
    say "Updates are off; skipping"
    return 0
  fi

  if kid_session_active; then
    say "Kid session is active; skipping, will retry tomorrow"
    return 0
  fi

  # Resolve channel tag
  local image_base="ghcr.io/jmo-labs/tskfrce"
  local tag services="backend frontend blocker edge"
  if [ "$channel" = "eval" ]; then
    tag=":eval"
  elif [ "$channel" = "stable" ]; then
    tag=":2"
  else
    die "Unknown UPDATE_CHANNEL=$channel"
  fi

  say "Pulling from channel $channel: tag=$tag"

  # Save old digests for rollback
  [ -f "$DIGESTS_FILE" ] && cp "$DIGESTS_FILE" "$DIGESTS_FILE.bak"

  # Verify and pull all services, collect digests, build compose override
  local override_file="$DIR/docker-compose.override.yml"
  : >"$DIGESTS_FILE"
  : >"$override_file"
  echo "services:" >"$override_file"

  for svc in $services; do
    local image="$image_base/$svc$tag"
    say "Pulling and verifying $svc..."
    docker pull "$image" || die "Failed to pull $svc"
    local digest
    digest=$(get_verified_digest "$image") || die "Signature verification failed: $image"
    say "Verified $svc: $digest"
    echo "$svc=$digest" >>"$DIGESTS_FILE"
    # Add to compose override with exact digest
    printf "  %s:\n    image: %s@%s\n" "$svc" "$image_base/$svc" "$digest" >>"$override_file"
  done
  say "Recorded new digests in override"

  # Deploy with verified digests via override
  say "Deploying update with verified digests..."
  (cd "$DIR" && docker compose -f "$COMPOSE_FILE" -f "$override_file" up -d) ||
    die "Failed to deploy"

  # Health check (same endpoints as install.sh wait_healthy)
  say "Running health check..."
  local port api_port max_attempts=120 attempt=0
  port=$(env_value FRONTEND_PORT | sed 's/.*://')
  port="${port:-3000}"
  api_port=$(env_value BACKEND_PORT | sed 's/.*://')
  api_port="${api_port:-8000}"

  while [ $attempt -lt $max_attempts ]; do
    if curl -fsS "http://127.0.0.1:$api_port/health" >/dev/null 2>&1 &&
       curl -fsS "http://127.0.0.1:$port/api/health" >/dev/null 2>&1; then
      say "Health check passed"
      alert_and_note "success" "$(env_value TASK4CE_TAG)" ""
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 1
  done

  # Health check failed; rollback
  say "Health check failed; rolling back..."
  if [ -f "$DIGESTS_FILE.bak" ]; then
    mv "$DIGESTS_FILE.bak" "$DIGESTS_FILE"
    # Recreate override from old digests
    local override_file="$DIR/docker-compose.override.yml"
    : >"$override_file"
    echo "services:" >"$override_file"
    while IFS='=' read -r svc digest; do
      [ -n "$svc" ] && printf "  %s:\n    image: %s@%s\n" "$svc" "$image_base/$svc" "$digest" >>"$override_file"
    done <"$DIGESTS_FILE"
  fi
  (cd "$DIR" && docker compose -f "$COMPOSE_FILE" -f "$override_file" down) || true
  (cd "$DIR" && docker compose -f "$COMPOSE_FILE" -f "$override_file" up -d) ||
    die "Rollback failed; box may be down"

  say "Rollback complete"
  local old_tag
  old_tag=$(grep "^backend=" "$DIGESTS_FILE" 2>/dev/null | cut -d= -f2 | cut -d: -f2)
  old_tag="${old_tag:-unknown}"
  alert_and_note "failed" "$(env_value TASK4CE_TAG)" "$old_tag"
  return 1
}

main "$@"
