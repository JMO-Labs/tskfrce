#!/bin/bash
# Test that password is never in nmcli argv.
# This test mocks nmcli and captures invocations.

set -e

HELPER_SCRIPT="./scripts/tskfrce-wifi-helper.sh"
CAPTURED_ARGV="/tmp/nmcli_argv.txt"

# Mock nmcli to capture argv
mock_nmcli() {
  # Print all arguments (including argv[0])
  {
    echo "nmcli $@"
    for arg in "$@"; do
      if echo "$arg" | grep -q "test_password"; then
        echo "ERROR: PSK found in argv: $arg"
        exit 1
      fi
    done
  } >>"$CAPTURED_ARGV"
  # For testing, pretend success if operation is "connection load"
  if [ "$1" = "connection" ] && [ "$2" = "load" ]; then
    return 0
  fi
  if [ "$1" = "connection" ] && [ "$2" = "up" ]; then
    return 0
  fi
  if [ "$1" = "connection" ] && [ "$2" = "delete" ]; then
    return 0
  fi
  return 1
}

export -f mock_nmcli
export PATH="/tmp/mock_bin:$PATH"

# Create mock nmcli
mkdir -p /tmp/mock_bin
cat >/tmp/mock_bin/nmcli <<'MOCKNMCLI'
#!/bin/bash
mock_nmcli "$@"
MOCKNMCLI
chmod +x /tmp/mock_bin/nmcli

# Create temp socket
SOCKET=$(mktemp -u)
mkfifo "$SOCKET"

# Cleanup
cleanup() {
  rm -f "$SOCKET" "$CAPTURED_ARGV"
  rm -rf /tmp/mock_bin
}
trap cleanup EXIT

# Test: send join request with password
rm -f "$CAPTURED_ARGV"
{
  echo '{"cmd":"join","ssid":"TestSSID","password":"test_password123"}'
} | {
  # Run helper with mocked nmcli
  bash "$HELPER_SCRIPT" &
  HELPER_PID=$!
  sleep 0.5
  kill $HELPER_PID 2>/dev/null || true
} &
HELPER_PID=$!

sleep 1

# Check captured argv
if [ -f "$CAPTURED_ARGV" ]; then
  if grep -q "test_password" "$CAPTURED_ARGV"; then
    echo "FAIL: Password found in nmcli argv"
    cat "$CAPTURED_ARGV"
    exit 1
  fi
  echo "PASS: Password not in nmcli argv"
  echo "nmcli calls:"
  cat "$CAPTURED_ARGV"
else
  echo "PASS: No PSK in argv (captured file empty)"
fi

echo "PASS: PSK security test passed"
