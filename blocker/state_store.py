"""Authoritative blocked-MAC set pushed by the app."""

from __future__ import annotations

import logging
import re
import threading
from collections.abc import Callable

from blocker.homework import norm_name, parse_until

log = logging.getLogger(__name__)

# Deliberate copy of the app's MAC_RE (blocker must not import backend code).
MAC_RE = re.compile(r"^([0-9a-f]{2}:){5}[0-9a-f]{2}$")
MAX_NAMES = 1000  # per list; generous for real lists, bounds a hostile payload
MAX_NAME_LEN = 253  # RFC 1035 name length


def _clean_names(names, field: str) -> list[str]:
    if not isinstance(names, list) or len(names) > MAX_NAMES:
        raise ValueError(  # the API maps ValueError to a 400
            f"homework '{field}' must be a list of at most {MAX_NAMES} names."
        )
    out: set[str] = set()
    for n in names:
        if not isinstance(n, str) or not norm_name(n) or len(norm_name(n)) > MAX_NAME_LEN:
            raise ValueError(f"homework '{field}' entries must be non-empty domain names.")
        out.add(norm_name(n))
    return sorted(out)


def _clean_homework(homework) -> dict[str, dict]:
    """Validate and normalize the homework map once, at the store boundary."""
    if not isinstance(homework, dict):
        raise ValueError("'homework' must be an object.")  # noqa: TRY004 - API -> 400
    out: dict[str, dict] = {}
    for mac, hw in homework.items():
        mac = str(mac).strip().lower()
        if not MAC_RE.match(mac):
            raise ValueError(f"'{mac}' is not a valid MAC address.")
        if not isinstance(hw, dict):
            raise ValueError("homework must have 'allow' and 'block' lists.")  # noqa: TRY004
        if parse_until(hw.get("until")) is None:
            raise ValueError("homework 'until' must be an ISO timestamp with a timezone.")
        out[mac] = {
            "allow": _clean_names(hw.get("allow"), "allow"),
            "block": _clean_names(hw.get("block"), "block"),
            "until": str(hw["until"]),
        }
    return out


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

        new_homework = _clean_homework(homework or {})

        with self._lock:
            self._blocked = new_blocked
            self._homework = new_homework
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
