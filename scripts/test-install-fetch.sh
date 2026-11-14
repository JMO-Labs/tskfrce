#!/bin/sh
# fetch_code test (no Docker): re-install over an existing dir drops files deleted upstream,
# keeps .env / data / user files, and leaves exactly one backup of the previous code.
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
fail() { echo "FAIL: $1" >&2; exit 1; }

mkdir -p "$T/src/app" "$T/dir/app" "$T/dir/data"
echo new >"$T/src/app/a.txt"
echo example >"$T/src/.env.example"
echo tracked >"$T/src/.env.local"
echo old >"$T/dir/app/a.txt"
echo stale >"$T/dir/app/FeedbackShots.tsx"
echo stale >"$T/dir/old-root-file"
echo SECRET_KEY=abc >"$T/dir/.env"
echo X=1 >"$T/dir/.env.local"
echo db >"$T/dir/data/db.sqlite"
echo log >"$T/dir/update-check.log"
echo mine >"$T/dir/custom.conf"
touch "$T/dir/.task4ce-install"

export TASK4CE_DIR="$T/dir" TASK4CE_SRC="$T/src" TASK4CE_KEEP="custom.conf"
# shellcheck disable=SC1091
TASK4CE_SOURCE_ONLY=1 . "$ROOT/install.sh"

fetch_code >/dev/null
[ "$(cat "$T/dir/app/a.txt")" = new ] || fail "new code not installed"
[ ! -e "$T/dir/app/FeedbackShots.tsx" ] || fail "stale file survived"
[ ! -e "$T/dir/old-root-file" ] || fail "stale root file survived"
[ "$(cat "$T/dir/.env")" = SECRET_KEY=abc ] || fail ".env changed"
[ "$(cat "$T/dir/.env.local")" = X=1 ] || fail "user .env.local not kept"
[ "$(cat "$T/dir/.env.example")" = example ] || fail ".env.example not installed"
[ -f "$T/dir/data/db.sqlite" ] || fail "data/ lost"
[ -f "$T/dir/update-check.log" ] || fail "update-check.log lost"
[ -f "$T/dir/custom.conf" ] || fail "TASK4CE_KEEP file lost"
[ "$(cat "$T/dir/.previous-code/app/FeedbackShots.tsx")" = stale ] || fail "no backup of previous code"
[ ! -e "$T/dir/.staging" ] || fail "staging dir left behind"

# Second install: backup is replaced, not accumulated.
fetch_code >/dev/null
[ ! -e "$T/dir/.previous-code/app/FeedbackShots.tsx" ] || fail "old backup not overwritten"
[ "$(cat "$T/dir/.previous-code/app/a.txt")" = new ] || fail "backup is not the previous install"
[ ! -e "$T/dir/.previous-code/.previous-code" ] || fail "backups nested"

# Foreign non-empty dir: refuse, leave files untouched.
mkdir -p "$T/foreign"
echo precious >"$T/foreign/photo.jpg"
if (DIR="$T/foreign"; fetch_code >/dev/null 2>&1); then fail "foreign dir not refused"; fi
[ "$(cat "$T/foreign/photo.jpg")" = precious ] || fail "foreign file touched"
[ ! -e "$T/foreign/.previous-code" ] || fail "foreign dir got backup dir"
echo "install fetch test passed"
