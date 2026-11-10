#!/bin/bash
# Tests scripts/db-migrate.sh with a fake `docker` (FAKE_MIGRATE_RC sets the migrate exit code).
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
mkdir "$T/bin"
cat >"$T/bin/docker" <<'FAKE'
#!/bin/sh
echo "$*" >>"$FAKE_LOG"
case "$*" in *migrate-to*) exit "${FAKE_MIGRATE_RC:-0}" ;; esac
exit 0
FAKE
chmod +x "$T/bin/docker"
export PATH="$T/bin:$PATH" FAKE_LOG="$T/log"

fail() { echo "FAIL: $1" >&2; exit 1; }
URL='postgresql+psycopg://u:s3cretpw@db:5432/app'
setup() {
  rm -rf "$T/box" "$T/log"; mkdir "$T/box"; : >"$T/log"
  printf 'SECRET_KEY=abc\nDATABASE_URL=\nOTHER=1\n' >"$T/box/.env"
  chmod 600 "$T/box/.env"
  cp "$T/box/.env" "$T/orig"
}

# usage and URL validation
setup
(cd "$T/box" && bash "$ROOT/scripts/db-migrate.sh" >/dev/null 2>&1) && fail "no-arg accepted"
(cd "$T/box" && bash "$ROOT/scripts/db-migrate.sh" a b >/dev/null 2>&1) && fail "two args accepted"
(cd "$T/box" && bash "$ROOT/scripts/db-migrate.sh" mysql://x >/dev/null 2>&1) && fail "bad scheme accepted"
[ ! -s "$T/log" ] || fail "docker ran on invalid input"

# success
setup
out="$(cd "$T/box" && FAKE_MIGRATE_RC=0 bash "$ROOT/scripts/db-migrate.sh" "$URL" 2>&1)" || fail "success path exited non-zero"
case "$out" in *s3cretpw*) fail "password printed" ;; esac
grep -qxF "DATABASE_URL=$URL" "$T/box/.env" || fail "DATABASE_URL not set"
grep -q '^SECRET_KEY=abc$' "$T/box/.env" || fail "other keys lost"
[ "$(grep -c '^DATABASE_URL=' "$T/box/.env")" = 1 ] || fail "DATABASE_URL duplicated"
set -- "$T"/box/.env.bak-*
[ -f "$1" ] || fail "no backup"
cmp -s "$1" "$T/orig" || fail "backup differs from original"
[ "$(stat -c %a "$T/box/.env")" = 600 ] || fail ".env mode not 600"
[ "$(stat -c %a "$1")" = 600 ] || fail "backup mode not 600"
grep -q 'stop backend' "$T/log" || fail "backend not stopped"
grep -q 'up -d' "$T/log" || fail "no up -d"

# append when no DATABASE_URL line
setup
printf 'SECRET_KEY=abc\n' >"$T/box/.env"
(cd "$T/box" && bash "$ROOT/scripts/db-migrate.sh" "$URL" >/dev/null 2>&1) || fail "append path failed"
grep -qxF "DATABASE_URL=$URL" "$T/box/.env" || fail "DATABASE_URL not appended"

# failure
setup
out="$(cd "$T/box" && FAKE_MIGRATE_RC=3 bash "$ROOT/scripts/db-migrate.sh" "$URL" 2>&1)" && fail "failure path exited 0"
case "$out" in *s3cretpw*) fail "password printed on failure" ;; esac
case "$out" in *untouched*) ;; *) fail "no untouched message" ;; esac
cmp -s "$T/box/.env" "$T/orig" || fail ".env changed on failure"
ls "$T"/box/.env.bak-* >/dev/null 2>&1 && fail "backup made on failure"
grep -q 'up -d' "$T/log" || fail "no up -d on failure"
echo "db-migrate test passed"
