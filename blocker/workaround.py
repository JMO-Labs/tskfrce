"""Spots DNS lookups for VPN / private-DNS / proxy / Tor names, grouped per device MAC."""

from __future__ import annotations

import threading
import time
from collections.abc import Callable
from functools import cache
from pathlib import Path

CATEGORIES = ("vpn", "private_dns", "proxy", "tor")
DOT_WINDOW = 10.0  # s: a private_dns lookup counts only if a TCP 853 SYN follows
DOT_PORT = 853
MAX_MACS = 1000  # memory bound between drains
_DATA = Path(__file__).parent / "data" / "workaround_domains.txt"


@cache
def _entries() -> tuple[tuple[str, str], ...]:
    out = []
    for line in _DATA.read_text().splitlines():
        line = line.split("#", 1)[0].strip()
        if not line:
            continue
        parts = line.split(None, 1)
        if len(parts) == 2 and parts[0] in (*CATEGORIES, "ignore"):
            out.append((parts[0], parts[1].strip().lower()))
    return tuple(out)


@cache
def _index() -> dict[str, str]:
    return {domain: cat for cat, domain in _entries()}


def categorize(qname: str) -> str | None:
    """Category of qname if it equals or is a subdomain of a listed domain, else None."""
    labels = qname.lower().rstrip(".").split(".")
    idx = _index()
    found = None
    for i in range(len(labels)):  # longest suffix first, so "ignore" beats its parent entry
        cat = idx.get(".".join(labels[i:]))
        if cat == "ignore":
            return None
        found = found or cat
    return found


class WorkaroundCounter:
    def __init__(
        self, resolve: Callable[[str], str | None], clock: Callable[[], float] = time.monotonic
    ) -> None:
        self._resolve = resolve
        self._clock = clock
        self._pending: dict[str, float] = {}  # mac -> time of last private_dns lookup
        self._found: dict[str, set[str]] = {}
        self._lock = threading.Lock()

    def add(self, ip: str, qname: str) -> None:
        cat = categorize(qname)
        if cat is None:
            return
        mac = self._resolve(ip)
        if mac is None:
            return
        mac = mac.lower()
        with self._lock:
            if cat == "private_dns":  # Android Private DNS follows with DoT; app DoH (443) doesn't
                if mac in self._pending or len(self._pending) < MAX_MACS:
                    self._pending[mac] = self._clock()
                return
            if mac not in self._found and len(self._found) >= MAX_MACS:
                return
            self._found.setdefault(mac, set()).add(cat)

    def dot(self, mac: str) -> None:
        """A TCP 853 SYN from mac: confirms a private_dns lookup made within DOT_WINDOW."""
        mac = mac.lower()
        with self._lock:
            t = self._pending.pop(mac, None)
            if t is None or self._clock() - t > DOT_WINDOW:
                return
            if mac not in self._found and len(self._found) >= MAX_MACS:
                return
            self._found.setdefault(mac, set()).add("private_dns")

    def drain(self) -> dict[str, list[str]]:
        with self._lock:
            out, self._found = self._found, {}
            now = self._clock()
            self._pending = {m: t for m, t in self._pending.items() if now - t <= DOT_WINDOW}
        return {m: sorted(c) for m, c in out.items()}
