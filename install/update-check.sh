#!/bin/bash
# t@sk4ce unattended updater. systemd runs it nightly as root (update-check.timer).
# Pulls the channel's images, verifies every signature, deploys exact digests, checks
# health, rolls back on failure, and tells the parents. Also performs a pending OS reboot
# (unattended-upgrades security fixes) when no kid timer is running.
# Skips the night (exit 0) when: updates are off, a kid timer is running, the backend
# can't be asked, or the registry can't be reached.
set -euo pipefail

DIR="${TASK4CE_DIR:-/root/task4ce}"
ENV_FILE="$DIR/.env"
COMPOSE="$DIR/docker-compose.prod.yml"
OVERRIDE="$DIR/docker-compose.override.yml"
LOG="$DIR/update-check.log"
REPO="ghcr.io/jmo-labs/tskfrce"
COSIGN="gcr.io/projectsigstore/cosign:v2.4.1@sha256:b03690aa52bfe94054187142fba24dc54137650682810633901767d8a3e15b31"
IDENTITY='^https://github\.com/JMO-Labs/tskfrce/\.github/workflows/ci-cd\.yml@refs/(heads/main|tags/(v|eval-).*)$'
ISSUER="https://token.actions.githubusercontent.com"
REBOOT_FLAG="${REBOOT_FLAG:-/var/run/reboot-required}"

say() { printf '[%s] %s\n' "$(date '+%F %T')" "$*" | tee -a "$LOG"; }
env_value() { sed -n "s/^$1=//p" "$ENV_FILE" | head -n 1; }
port_of() { local p; p=$(env_value "$1"); p=${p##*:}; echo "${p:-$2}"; }
json() { python3 -c 'import json,sys; v=json.load(sys.stdin).get(sys.argv[1]); print("" if v is None else str(v).lower() if isinstance(v,bool) else v)' "$1"; }
dc() { (cd "$DIR" && docker compose -f "$COMPOSE" "$@"); }

# internal <GET|POST> <path> [json body]: token-protected backend API on loopback
internal() {
  local args=(-fsS --max-time 10 -X "$1" -H "X-Internal-Token: $(env_value INTERNAL_TOKEN)")
  [ $# -ge 3 ] && args+=(-H 'Content-Type: application/json' -d "$3")
  curl "${args[@]}" "http://127.0.0.1:$(port_of BACKEND_PORT 8000)$2"
}

kid_timer_running() {
  local r
  r=$(internal GET /internal/kid-session-active) || return 0 # can't tell: assume yes (fail closed)
  [ "$(printf %s "$r" | json active)" != false ]
}

version() { curl -fsS --max-time 5 "http://127.0.0.1:$(port_of BACKEND_PORT 8000)/health" | json version; }

healthy() {
  local web
  web=$(port_of FRONTEND_PORT 3000)
  for _ in $(seq 1 90); do
    if [ -n "$(version 2>/dev/null)" ] && curl -fsS --max-time 5 -o /dev/null "http://127.0.0.1:$web/api/health"; then
      return 0
    fi
    sleep 2
  done
  return 1
}

# write_override <svc=image ...>: pin each service to an exact image
write_override() {
  { echo "# written by update-check.sh; delete to go back to TASK4CE_TAG images"; echo "services:"
    for kv in "$@"; do printf '  %s:\n    image: %s\n' "${kv%%=*}" "${kv#*=}"; done; } >"$OVERRIDE.new"
  mv "$OVERRIDE.new" "$OVERRIDE"
}

deploy() { (cd "$DIR" && docker compose -f "$COMPOSE" -f "$OVERRIDE" up -d --no-build) >>"$LOG" 2>&1; }

reboot_if_pending() {
  [ -f "$REBOOT_FLAG" ] || return 0
  if kid_timer_running; then say "OS reboot pending, but a kid timer is running; next night"; return 0; fi
  say "OS security updates need a reboot; rebooting now"
  systemctl reboot
}

update_app() {
  local state install channel tag major old new svc ref pulled digest running prev=() next=() changed=0
  install=$(env_value UPDATE_CHANNEL); install=${install:-stable}
  state=$(internal GET /internal/update-state) || { say "backend not answering; skipping tonight"; return 0; }
  channel=$(printf %s "$state" | json channel)
  # Defense in depth: an eval install only ever follows eval (or off), whatever the state says
  if [ "$install" = eval ] && [ "$channel" != off ]; then channel="eval"; fi
  [ "$channel" != off ] || { say "automatic updates are off"; return 0; }
  if kid_timer_running; then say "a kid timer is running; skipping tonight"; return 0; fi

  old=$(version) || { say "backend not healthy before update; skipping tonight"; return 0; }
  if [ "$channel" = eval ]; then tag="eval"; else
    major=$(printf %s "$state" | json requested_major)
    tag=${major:-${old%%.*}}
  fi
  case $tag in eval | [0-9] | [0-9][0-9]) ;; *) say "refusing odd tag '$tag'"; return 1 ;; esac

  for svc in $(dc ps --services --status running); do
    case $svc in backend | frontend | blocker | edge) ;; *) continue ;; esac
    ref="$REPO/$svc:$tag"
    if ! docker pull -q "$ref" >>"$LOG" 2>&1; then say "can't pull $ref (offline or not published); skipping tonight"; return 0; fi
    digest=$(docker image inspect --format '{{index .RepoDigests 0}}' "$ref")
    if ! docker run --rm "$COSIGN" verify --certificate-identity-regexp "$IDENTITY" \
      --certificate-oidc-issuer "$ISSUER" "$digest" >>"$LOG" 2>&1; then
      say "SIGNATURE CHECK FAILED for $digest; not updating"
      internal POST /internal/update-result "{\"result\":\"failed\",\"version\":\"$tag\",\"old_version\":\"$old\"}" >/dev/null || true
      return 1
    fi
    running=$(docker inspect --format '{{.Image}}' "$(dc ps -q "$svc")")
    pulled=$(docker image inspect --format '{{.Id}}' "$ref")
    [ "$running" = "$pulled" ] || changed=1
    docker tag "$running" "task4ce-rollback/$svc:prev" # keep the old image for rollback
    prev+=("$svc=task4ce-rollback/$svc:prev")
    next+=("$svc=$digest")
  done
  [ "$changed" = 1 ] || { say "already up to date ($old)"; return 0; }

  say "updating $old -> channel $tag"
  write_override "${next[@]}"
  if deploy && healthy; then
    new=$(version)
    say "updated to $new"
    internal POST /internal/update-result "{\"result\":\"success\",\"version\":\"$new\",\"old_version\":\"$old\"}" >/dev/null || true
    return 0
  fi
  say "health check failed; rolling back to $old"
  write_override "${prev[@]}"
  deploy || true
  healthy || say "ROLLBACK UNHEALTHY; the box needs attention"
  internal POST /internal/update-result "{\"result\":\"failed\",\"version\":\"$tag\",\"old_version\":\"$old\"}" >/dev/null || true
  return 1
}

main() {
  say "=== nightly update check ==="
  local rc=0
  update_app || rc=$?
  reboot_if_pending
  return "$rc"
}

[ "${UPDATE_CHECK_LIB:-0}" = 1 ] || main "$@"
