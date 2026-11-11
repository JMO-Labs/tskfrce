#!/bin/bash
# Pre-reboot hook for unattended-upgrades: skip reboot if kid session is active.

DIR="${TASK4CE_DIR:-$HOME/task4ce}"

# Check if kid session is active
if [ -f "$DIR/.kid_session_active" ]; then
  echo "Kid session is active; skipping reboot, will try again tomorrow"
  exit 1
fi

# Safe to reboot
exit 0
