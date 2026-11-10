#!/bin/bash
# Move the box from SQLite to Postgres. Run from the install dir (where .env lives):
#   bash scripts/db-migrate.sh postgresql://user:pass@host:5432/dbname
# Copies the data, then points .env at Postgres. On failure SQLite is left untouched.
set -eu

[ "$#" -eq 1 ] || { echo "usage: $0 <postgres-url>" >&2; exit 2; }
url="$1"
case "$url" in
  postgres://* | postgresql://* | postgresql+*://*) ;;
  *) echo "error: URL must start with postgres:// or postgresql://" >&2; exit 2 ;;
esac
[ -f .env ] || { echo "error: run this from the install dir (no .env here)" >&2; exit 2; }

dc() { docker compose -f docker-compose.prod.yml "$@"; }

dc stop backend
if dc run --rm --no-deps backend python -m app.cli migrate-to "$url"; then
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  bak=".env.bak-$stamp"
  (umask 077 && cp .env "$bak")
  tmp="$(umask 077 && mktemp .env.XXXXXX)"
  { grep -v '^DATABASE_URL=' .env || true; printf 'DATABASE_URL=%s\n' "$url"; } >"$tmp"
  chmod 600 "$tmp"
  mv "$tmp" .env
  dc up -d
  echo "Moved to Postgres. Previous .env saved as $bak; SQLite file kept as a backup."
else
  dc up -d
  echo "Migration failed. SQLite is untouched and the app is running as before." >&2
  exit 1
fi
