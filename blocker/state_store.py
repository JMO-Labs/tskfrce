"""Authoritative blocked-MAC set pushed by the app."""

from __future__ import annotations

import logging
import re
import threading
from collections.abc import Callable

log = logging.getLogger(__name__)

# Deliberate copy of the app's MAC_RE (blocker must not import backend code).
MAC_RE = re.compile(r"^([0-9a-f]{2}:){5}[0-9a-f]{2}$")


class StateStore:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._blocked: set[str] = set()
        self._homework: dict[str, dict] = {}
        self._callbacks: list[Callable[[set[str]], None]] = []

    def set_state(self, blocked: list[str], homework: dict | None = None) -> set[str]:
        """Set blocked MACs and homework state. Returns the updated blocked set."""
        new_blocked = {str(m).lower() for m in blocked}
        for mac in sorted(new_blocked):
            if not MAC_RE.match(mac):
                raise ValueError(f"'{mac}' is not a valid MAC address.")

        new_homework = homework or {}
        if not isinstance(new_homework, dict):
            raise ValueError("'homework' must be an object.")
        # Validate homework payload
        for mac, hw in new_homework.items():
            if not MAC_RE.match(mac.lower()):
                raise ValueError(f"'{mac}' is not a valid MAC address.")
            if not isinstance(hw, dict) or not isinstance(hw.get("allow"), list) or not isinstance(hw.get("block"), list):
                raise ValueError("homework must have 'allow' and 'block' lists.")

        with self._lock:
            self._blocked = new_blocked
            self._homework = {m.lower(): h for m, h in new_homework.items()}
            result = set(new_blocked)
            callbacks = list(self._callbacks)
        # Concurrent callers may fire callbacks out of order; subscribers should re-read current().
        for cb in callbacks:
            try:
                cb(set(result))
            except Exception:
                log.exception("state change callback failed")
        return result

    def set_blocked(self, macs: list[str]) -> set[str]:
        """Backward compatible wrapper for set_state without homework."""
        return self.set_state(macs)

    def current(self) -> set[str]:
        with self._lock:
            return set(self._blocked)

    def homework(self) -> dict[str, dict]:
        """Return the homework state map."""
        with self._lock:
            return dict(self._homework)

    def on_change(self, cb: Callable[[set[str]], None]) -> None:
        with self._lock:
            self._callbacks.append(cb)
