#!/bin/sh
# enable-hostname.sh test: key rewrite, idempotence, validation.
set -eu

S="$(cd "$(dirname "$0")" && pwd)/enable-hostname.sh"
D="$(mktemp -d)"
trap 'rm -rf "$D"' EXIT
E="$D/.env"
SEC="$(printf 'a%.0s' $(seq 64))"

fail() { echo "FAIL: $1" >&2; exit 1; }

printf '# keep me\nSECRET_KEY=abc\nCOMPOSE_PROFILES=blocker\nBOX_URL=http://192.168.1.5:3000\n' >"$E"
chmod 644 "$E"
sh "$S" abc123 "$SEC" "$E" || fail "script failed"
grep -qx 'BOX_URL=https://abc123.taskfrce.jmolabs.dev' "$E" || fail "BOX_URL"
grep -qx 'NTFY_PUBLIC_URL=https://abc123.taskfrce.jmolabs.dev:2443' "$E" || fail "NTFY_PUBLIC_URL"
grep -qx 'COMPOSE_PROFILES=blocker,edge' "$E" || fail "profiles"
grep -qx "BOX_ID=abc123" "$E" || fail "BOX_ID"
grep -qx "BOX_SECRET=$SEC" "$E" || fail "BOX_SECRET"
grep -qx 'SECRET_KEY=abc' "$E" || fail "other key lost"
grep -qx '# keep me' "$E" || fail "comment lost"
[ "$(stat -c %a "$E")" = 600 ] || fail "mode not 600"

before="$(cksum <"$E")"
sh "$S" abc123 "$SEC" "$E" || fail "second run failed"
[ "$before" = "$(cksum <"$E")" ] || fail "not idempotent"
[ "$(grep -c '^BOX_URL=' "$E")" = 1 ] || fail "duplicate keys"

printf 'FOO=1\n' >"$E"
sh "$S" abc123 "$SEC" "$E"
grep -qx 'COMPOSE_PROFILES=edge' "$E" || fail "profiles from empty"

before="$(cksum <"$E")"
sh "$S" ABC "$SEC" "$E" 2>/dev/null && fail "bad id accepted"
sh "$S" abc123 xyz "$E" 2>/dev/null && fail "bad secret accepted"
[ "$before" = "$(cksum <"$E")" ] || fail "file touched on bad input"
echo "enable-hostname test passed"
