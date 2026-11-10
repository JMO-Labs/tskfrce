#!/usr/bin/env bash
# Docker network lab driver. Run from repo root.
set -euo pipefail
cd "$(dirname "$0")/.."
export INTERNAL_TOKEN=labtoken
COMPOSE="docker compose -f lab/docker-compose.lab.yml"
API=http://10.99.0.3:8000
BLK=http://10.99.0.4:7777
USER_=labparent PASS_=labpassword1

_curl_parent() { $COMPOSE exec -T parent curl -s -m 30 "$@"; }
# Every probe runs from the parent container: without it, waits would only time out.
_running() { _mine && [ -n "$($COMPOSE ps -q --status running parent 2>/dev/null)" ]; }

# One lab per machine: fixed subnets and one compose project, so every checkout drives the same
# containers. Refuse to build over, test on or tear down another checkout's lab.
_others() {
  docker ps -a --filter label=com.docker.compose.project=task4ce-lab \
    --format '{{.Label "com.docker.compose.project.working_dir"}}' | sort -u | grep -vxF "$(pwd -P)/lab" || true
}
_mine() { [ -z "$(_others)" ]; }
_guard() {
  { [ -n "${LAB_FORCE:-}" ] || _mine; } && return 0
  echo "lab in use by $(_others | tr '\n' ' ')- one lab per machine; wait for it (LAB_FORCE=1 overrides)" >&2
  exit 3
}

_mac_of() {
  case "$1" in
    kid1) echo 02:99:00:00:00:11 ;;
    kid2) echo 02:99:00:00:00:12 ;;
    parent) echo 02:99:00:00:00:13 ;;
    *) echo "unknown host: $1" >&2; return 2 ;;
  esac
}

# ponytail: one login per lab session, cached; login is rate limited (10/min)
TOKEN_FILE="${XDG_RUNTIME_DIR:-/tmp}/task4ce-lab.token"
_token() {
  local t
  # access tokens live 30 min: log in again once the cached one is 20 min old
  find "$TOKEN_FILE" -mmin +20 -delete 2>/dev/null || true
  t=$(cat "$TOKEN_FILE" 2>/dev/null || true)
  if [ -z "$t" ] || [ "$t" = null ]; then
    t=$(_curl_parent -X POST "$API/api/v1/auth/login" -H 'Content-Type: application/json' \
      -d "{\"username\":\"$USER_\",\"password\":\"$PASS_\"}" | jq -r .access_token)
    [ "$t" != null ] && printf '%s' "$t" > "$TOKEN_FILE"
  fi
  printf '%s\n' "$t"
}

_devices() { _curl_parent -H "Authorization: Bearer $(_token)" "$API/api/v1/devices"; }

_id_of() {
  local mac; mac=$(_mac_of "$1")
  _devices | jq -r --arg m "$mac" '[.[] | select((.mac|ascii_downcase)==$m)][0].id // empty'
}

_need_id() {
  local id; id=$(_id_of "$1")
  [ -n "$id" ] || { echo "device $1 not found" >&2; exit 1; }
  echo "$id"
}

_post() { # path json
  _curl_parent -X POST -H "Authorization: Bearer $(_token)" -H 'Content-Type: application/json' -d "$2" "$API$1"
}

_wait_http() { # url
  _running || { echo "lab is not up (no parent container): run scripts/lab.sh up" >&2; return 1; }
  for _ in $(seq 180); do
    [ "$(_curl_parent -o /dev/null -w '%{http_code}' "$1" 2>/dev/null || true)" = 200 ] && return 0
    sleep 1
  done
  echo "timeout waiting for $1" >&2; return 1
}

# Hosts with br_netfilter loaded (k8s/dind CI runners) push bridged frames through iptables,
# where Docker's internal-network rules drop routed lab traffic (kid -> router -> wan).
# Plain hosts never filter bridged frames; restore that for the two lab bridges only.
# Runs in the router image (has iptables) on the daemon's host netns. Idempotent.
_bridges() { # -I | -D
  docker run --rm --privileged --network host --entrypoint sh task4ce-lab-router -c '
    for t in iptables ip6tables; do for b in tsk-lab tsk-wan; do
      if [ "$0" = -I ]; then $t -C DOCKER-USER -i $b -o $b -j ACCEPT 2>/dev/null && continue; fi
      $t "$0" DOCKER-USER -i $b -o $b -j ACCEPT 2>/dev/null || true
    done; done' "$1"
}

_up() {
  rm -f "$TOKEN_FILE"
  $COMPOSE up -d --build
  _bridges -I
  _wait_http "$API/health"
  _wait_http "$BLK/health"
  _curl_parent -o /dev/null -X POST "$API/api/v1/setup" -H 'Content-Type: application/json' \
    -d "{\"family_name\":\"Lab\",\"timezone\":\"UTC\",\"parent\":{\"username\":\"$USER_\",\"password\":\"$PASS_\",\"full_name\":\"Lab Parent\"}}" || true
  # API setup leaves the wizard "in progress"; mark it finished so the parent pages don't resume it
  _curl_parent -o /dev/null -X PUT -H "Authorization: Bearer $(_token)" -H 'Content-Type: application/json' \
    -d '{"step":null}' "$API/api/v1/setup/step"
  for _ in $(seq 30); do
    if [ -n "$(_id_of kid1 2>/dev/null || true)" ] && [ -n "$(_id_of kid2 2>/dev/null || true)" ]; then
      local id
      for id in $(_devices | jq -r '.[].id'); do
        _curl_parent -o /dev/null -X PATCH -H "Authorization: Bearer $(_token)" \
          -H 'Content-Type: application/json' -d '{"status":"guest"}' "$API/api/v1/devices/$id"
      done
      echo "lab up"; return 0
    fi
    sleep 2
  done
  echo "timeout waiting for device discovery" >&2; return 1
}

_portal() {
  local ip out
  ip=$($COMPOSE exec -T "$1" nslookup example.com 203.0.113.1 2>/dev/null | awk '/^Address/ && !/#/ {print $2}' | tail -1)
  [ "$ip" = 10.99.0.4 ] || { echo "dns: $ip" >&2; return 1; }
  out=$($COMPOSE exec -T "$1" curl -s -m 3 -o /dev/null -w '%{http_code} %{redirect_url}' http://203.0.113.1/ || true)
  echo "$out"
  [ "$out" = "302 http://task4ce.local/kid" ]
}

# Browser e2e: needs `up` first. Screenshots land in frontend/e2e-artifacts.
_e2e() {
  _running || _up  # standalone `e2e` (or after a torn-down lab) needs the whole lab, not just frontend
  $COMPOSE up -d --build frontend
  _wait_http "http://10.99.0.5:3000/api/health"
  python3 lab/e2e_run.py $COMPOSE --profile e2e run --rm e2e
}

cmd=${1:-}; shift || true
case "$cmd" in
  up) _guard; _up ;;
  down) _guard; rm -f "$TOKEN_FILE"; _bridges -D 2>/dev/null || true; $COMPOSE --profile e2e down -v ;;  # profile: also remove frontend
  e2e) _guard; _e2e ;;
  running) _running ;;
  wait-blocker) _wait_http "$BLK/health" ;;
  token) _token ;;
  device-id) _need_id "$1" ;;
  block) _post "/api/v1/devices/$(_need_id "$1")/override" '{"action":"lock"}' >/dev/null ;;
  unblock) _post "/api/v1/devices/$(_need_id "$1")/override" '{"action":"unlock"}' >/dev/null ;;
  check) $COMPOSE exec -T "$1" sh -c 'curl -s -m 3 http://203.0.113.1/ | grep -q "fake internet"' && exit 0 || exit 1 ;;
  check6) $COMPOSE exec -T "$1" sh -c 'curl -s -m 3 "http://[2001:db8:1::1]/" | grep -q "fake internet"' && exit 0 || exit 1 ;;
  portal) _portal "$1" && exit 0 || exit 1 ;;
  resist)
    $COMPOSE exec -T "$1" ip neigh replace 10.99.0.2 lladdr 02:99:00:00:00:02 nud permanent dev eth0
    $COMPOSE exec -T "$1" ip -6 neigh replace fd00:99::2 lladdr 02:99:00:00:00:02 nud permanent dev eth0 ;;
  reset)
    $COMPOSE exec -T "$1" ip neigh flush nud all dev eth0
    $COMPOSE exec -T "$1" ip -6 neigh flush nud all dev eth0 ;;
  resisting)
    mac=$(_mac_of "$1")
    _devices | jq -r --arg m "$mac" '[.[] | select((.mac|ascii_downcase)==$m)][0].resisting // false' ;;
  test-block) _post "/api/v1/devices/$(_need_id "$1")/test-block" '{}' ;;
  *) echo "usage: $0 {up|down|e2e|running|wait-blocker|token|device-id|block|unblock|check|check6|portal|resist|reset|resisting|test-block} [host]" >&2; exit 2 ;;
esac
