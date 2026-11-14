#!/bin/sh
# t@sk4ce installer for a home box (Raspberry Pi OS, Debian, Ubuntu; 64-bit Intel/AMD or ARM).
#   curl -fsSL https://jmo-labs.github.io/tskfrce/install.sh | sh
# Run it again any time to update. Your settings and data are kept.
#
# Optional settings (environment variables):
#   TASK4CE_DIR          where to install            (default ~/task4ce)
#   TASK4CE_REF          branch, tag or commit       (default main)
#   TASK4CE_SRC          use this local folder instead of downloading (for tests)
#   TASK4CE_PORT         web port                    (default 3000, first install only)
#   TASK4CE_API_PORT     loopback API port           (default 8000, first install only)
#   TASK4CE_SKIP_BLOCKER=1  do not start the internet pauser (tests)
#   TASK4CE_YES=1        answer yes to "install Docker?"
#   TASK4CE_PROJECT, TASK4CE_SUBNET, TASK4CE_BRIDGE_GW, TASK4CE_FRONTEND_IP   side-by-side installs (tests)

set -eu

DIR="${TASK4CE_DIR:-$HOME/task4ce}"
REF="${TASK4CE_REF:-main}"
PORT="${TASK4CE_PORT:-3000}"
API_PORT="${TASK4CE_API_PORT:-8000}"
REPO="JMO-Labs/tskfrce"
SUDO=""

say() { printf '%s\n' "$*"; }
die() {
  printf '\nSomething went wrong: %s\n' "$1" >&2
  [ -n "${2:-}" ] && printf 'What to do: %s\n' "$2" >&2
  exit 1
}
have() { command -v "$1" >/dev/null 2>&1; }

check_system() {
  [ "$(uname -s)" = "Linux" ] ||
    die "This installer is for a Linux home box (like a Raspberry Pi)." \
      "Set up a small Linux computer and run this command on it. See the install guide on the site."
  case "$(uname -m)" in
    x86_64 | amd64 | aarch64 | arm64) ;;
    *) die "This computer's processor ($(uname -m)) is not supported." \
      "Use a 64-bit Raspberry Pi (3 or newer) or a 64-bit Intel/AMD computer." ;;
  esac
  have curl || die "The 'curl' tool is missing." "Run: sudo apt install curl   then run this command again."
  have tar || die "The 'tar' tool is missing." "Run: sudo apt install tar   then run this command again."
}

ask_yes() {
  [ "${TASK4CE_YES:-}" = "1" ] && return 0
  [ -r /dev/tty ] || return 1
  printf '%s [y/N] ' "$1" >/dev/tty
  read -r answer </dev/tty || return 1
  case "$answer" in y | Y | yes | YES) return 0 ;; *) return 1 ;; esac
}

pick_docker() {
  if docker info >/dev/null 2>&1; then return 0; fi
  if have sudo && sudo docker info >/dev/null 2>&1; then
    SUDO="sudo"
    return 0
  fi
  return 1
}

ensure_docker() {
  if have docker && pick_docker; then return 0; fi
  if ! have docker; then
    say "t@sk4ce needs Docker, a free tool that runs it in a tidy box."
    ask_yes "Install Docker now?" ||
      die "Docker is not installed." \
        "Install it from https://docs.docker.com/engine/install/ and run this command again."
    say "Installing Docker (this takes a few minutes)..."
    curl -fsSL https://get.docker.com | sh ||
      die "Docker did not install." "Check the internet connection and run this command again."
    if have sudo; then sudo systemctl enable --now docker >/dev/null 2>&1 || true; fi
  fi
  pick_docker ||
    die "Docker is installed but not running, or this user may not use it." \
      "Run: sudo systemctl start docker   then run this command again."
  $SUDO docker compose version >/dev/null 2>&1 ||
    die "Docker is missing its 'compose' part." \
      "Run: sudo apt install docker-compose-plugin   then run this command again."
}

lan_ip() {
  ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p' | head -n 1
}
lan_iface() {
  ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* dev \([^ ]*\).*/\1/p' | head -n 1
}
random_hex() {
  if have openssl; then openssl rand -hex 32; else od -An -N32 -tx1 /dev/urandom | tr -d ' \n'; fi
}

fetch_code() {
  mkdir -p "$DIR" || die "Could not create $DIR." "Pick another folder: TASK4CE_DIR=/some/folder"
  if [ -n "${TASK4CE_SRC:-}" ]; then
    say "Copying t@sk4ce from $TASK4CE_SRC ..."
    (cd "$TASK4CE_SRC" && tar --exclude=.git --exclude=node_modules --exclude=.next \
      --exclude=./data --exclude=./.env --exclude=__pycache__ --exclude=.venv \
      --exclude=e2e-artifacts -cf - .) | tar -C "$DIR" -xf - ||
      die "Could not copy the files from $TASK4CE_SRC."
  else
    say "Downloading t@sk4ce ($REF) ..."
    curl -fsSL "https://codeload.github.com/$REPO/tar.gz/$REF" | tar -C "$DIR" --strip-components=1 -xzf - ||
      die "The download failed." "Check the internet connection and run this command again."
  fi
}

write_env() {
  if [ -f "$DIR/.env" ]; then
    say "Keeping your existing settings (.env)."
    return 0
  fi
  ip_addr="$(lan_ip)"
  [ -n "$ip_addr" ] || ip_addr="$(hostname -I 2>/dev/null | cut -d' ' -f1)"
  [ -n "$ip_addr" ] || ip_addr="localhost"
  umask 077
  {
    echo "# Written by install.sh. Safe to edit; re-running the installer keeps this file."
    echo "COMPOSE_PROJECT_NAME=${TASK4CE_PROJECT:-task4ce}"
    [ "${TASK4CE_SKIP_BLOCKER:-}" = "1" ] || echo "COMPOSE_PROFILES=blocker"
    echo "SECRET_KEY=$(random_hex)"
    echo "INTERNAL_TOKEN=$(random_hex)"
    echo "BOX_URL=http://$ip_addr:$PORT"
    ntfy_port="${NTFY_PORT:-2586}"
    echo "NTFY_PUBLIC_URL=http://$ip_addr:${ntfy_port##*:}"
    [ -z "${NTFY_PORT:-}" ] || echo "NTFY_PORT=$NTFY_PORT"
    echo "TRUSTED_HOSTS=localhost,127.0.0.1,backend"
    echo "FRONTEND_PORT=0.0.0.0:$PORT"
    echo "BACKEND_PORT=127.0.0.1:$API_PORT"
    echo "BLOCKER_BACKEND_URL=http://127.0.0.1:$API_PORT"
    echo "LAN_IFACE=" # empty = enforce on every LAN interface; set only to restrict to one
    [ -z "${TASK4CE_SUBNET:-}" ] || echo "TASK4CE_SUBNET=$TASK4CE_SUBNET"
    [ -z "${TASK4CE_BRIDGE_GW:-}" ] || echo "TASK4CE_BRIDGE_GW=$TASK4CE_BRIDGE_GW"
    [ -z "${TASK4CE_FRONTEND_IP:-}" ] || echo "TASK4CE_FRONTEND_IP=$TASK4CE_FRONTEND_IP"
  } >"$DIR/.env"
}

env_value() { sed -n "s/^$1=//p" "$DIR/.env" | head -n 1; }

wait_healthy() {
  port="$(env_value FRONTEND_PORT | sed 's/.*://')"
  api="$(env_value BACKEND_PORT | sed 's/.*://')"
  say "Starting up. This can take a minute..."
  waited=0
  while [ "$waited" -lt 600 ]; do
    if curl -fsS "http://127.0.0.1:${api:-8000}/health" >/dev/null 2>&1 &&
      curl -fsS "http://127.0.0.1:${port:-3000}/api/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 3
    waited=$((waited + 3))
  done
  return 1
}

install_updater() {
  # Tests and non-systemd hosts skip this; auto-updates are optional, the app still runs.
  [ "${TASK4CE_SKIP_UPDATER:-0}" = 1 ] && return 0
  [ -x "$DIR/install/update-check.sh" ] && have systemctl || return 0
  root=""
  if [ "$(id -u)" != 0 ]; then
    have sudo || { say "Skipping automatic updates (needs sudo). Re-run this installer to update."; return 0; }
    root="sudo"
  fi
  say "Installing unattended update service..."
  $root install -m 0755 "$DIR/install/update-check.sh" /usr/local/bin/update-check.sh
  $root install -m 0644 "$DIR/install/update-check.timer" /etc/systemd/system/update-check.timer
  # The service runs as root, so tell it where this install lives.
  sed "s|^ExecStart=.*|Environment=TASK4CE_DIR=$DIR\nExecStart=/usr/local/bin/update-check.sh|" \
    "$DIR/install/update-check.service" | $root tee /etc/systemd/system/update-check.service >/dev/null
  $root systemctl daemon-reload
  # Timer only: it activates the service by name at 03:00; starting it must not run a check now.
  $root systemctl enable --now update-check.timer
}

main() {
  # Hold the lock for the whole install so update-check.sh never reboots/updates mid-install.
  lock=/run/lock/tskfrce-install.lock
  root=""
  [ "$(id -u)" = 0 ] || { have sudo && root="sudo"; }
  # Root-owned, read-only fd: never O_CREAT a file another user may own (fs.protected_regular).
  if have flock && $root touch "$lock" 2>/dev/null && exec 9<"$lock"; then flock -w 600 9 || true; fi
  check_system
  ensure_docker
  fetch_code
  write_env
  # Images match the code: release tag v1.2.3 -> image 1.2.3, otherwise latest (main).
  # Passed through env (sudo drops exports) so it wins over .env on upgrades.
  case "$REF" in v[0-9]*) tag="${REF#v}" ;; *) tag="${TASK4CE_TAG:-latest}" ;; esac
  dc() { (cd "$DIR" && $SUDO env TASK4CE_TAG="$tag" docker compose -f docker-compose.prod.yml "$@"); }
  # Remember the tag: a reboot or a plain `docker compose up` must keep these images, not fall back to :latest.
  if grep -q '^TASK4CE_TAG=' "$DIR/.env"; then
    sed -i "s/^TASK4CE_TAG=.*/TASK4CE_TAG=$tag/" "$DIR/.env"
  else
    echo "TASK4CE_TAG=$tag" >>"$DIR/.env"
  fi
  # Set UPDATE_CHANNEL based on tag (eval- prefix = eval channel, else stable).
  channel="stable"
  case "$tag" in eval-*) channel="eval" ;; esac
  if grep -q '^UPDATE_CHANNEL=' "$DIR/.env"; then
    sed -i "s/^UPDATE_CHANNEL=.*/UPDATE_CHANNEL=$channel/" "$DIR/.env"
  else
    echo "UPDATE_CHANNEL=$channel" >>"$DIR/.env"
  fi
  install_updater
  say "Downloading t@sk4ce..."
  # Prebuilt amd64/arm64 images; build on the box only if the download fails.
  # TASK4CE_BUILD=1 forces a local build (the smoke test checks this checkout's code).
  help="Run: cd $DIR && docker compose -f docker-compose.prod.yml logs   and share what it says when asking for help."
  if [ "${TASK4CE_BUILD:-0}" = 1 ] || ! dc pull; then
    say "Building on this box instead (slow, needs 4 GB of memory)..."
    dc build || die "Docker could not build t@sk4ce." "$help"
  fi
  dc up -d --no-build || die "Docker could not start t@sk4ce." "$help"
  wait_healthy ||
    die "t@sk4ce did not answer within 10 minutes." \
      "Wait a minute and open the address below. If it still fails: cd $DIR && docker compose -f docker-compose.prod.yml logs"
  say ""
  say "t@sk4ce is running. Open $(env_value BOX_URL) on your phone or computer."
  say "First time? It will walk you through setup."
}

main "$@"
