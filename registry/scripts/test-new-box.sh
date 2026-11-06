#!/bin/sh
# new-box.sh test: npx stubbed on PATH; claim code format and that it never reaches the registry.
set -eu
S="$(cd "$(dirname "$0")" && pwd)/new-box.sh"
D="$(mktemp -d)"
trap 'rm -rf "$D"' EXIT
fail() { echo "FAIL: $1" >&2; exit 1; }
printf '#!/bin/sh\necho "$@" >>"%s/npx.log"\n' "$D" >"$D/npx"
chmod +x "$D/npx"
OUT="$(PATH="$D:$PATH" sh "$S")" || fail "script failed"
CODE="$(echo "$OUT" | sed -n 's/^CLAIM_CODE=//p')"
echo "$CODE" | grep -Eq '^[0-9A-HJKMNP-TV-Z]{10}$' || fail "claim code format"
ID="$(echo "$OUT" | sed -n 's/^BOX_ID=//p')"
echo "$OUT" | grep -qx "STICKER_QR2=https://$ID.taskfrce.jmolabs.dev/setup#claim=$CODE" || fail "QR2"
[ "$(echo "$OUT" | sed -n '1p;2p;3p;4p' | cut -d= -f1 | tr '\n' ' ')" = "BOX_ID BOX_SECRET CLAIM_CODE STICKER_QR2 " ] || fail "order"
[ -s "$D/npx.log" ] || fail "npx not called"
grep -q "$CODE" "$D/npx.log" && fail "claim code sent to registry"
echo "new-box test passed"
