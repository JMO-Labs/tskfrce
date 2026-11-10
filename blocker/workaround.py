"""Spots DNS lookups for VPN / private-DNS / proxy / Tor names, grouped per device MAC."""

from __future__ import annotations

import threading
from collections.abc import Callable
from functools import cache
from pathlib import Path

CATEGORIES = ("vpn", "private_dns", "proxy", "tor")
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
    def __init__(self, resolve: Callable[[str], str | None]) -> None:
        self._resolve = resolve
        self._found: dict[str, set[str]] = {}
        self._lock = threading.Lock()

    def add(self, ip: str, qname: str) -> None:
        cat = categorize(qname)
        if cat is None:
            return
        mac = self._resolve(ip)
        if mac is None:
            return
        with self._lock:
            if mac not in self._found and len(self._found) >= MAX_MACS:
                return
            self._found.setdefault(mac, set()).add(cat)

    def drain(self) -> dict[str, list[str]]:
        with self._lock:
            out, self._found = self._found, {}
        return {m: sorted(c) for m, c in out.items()}
