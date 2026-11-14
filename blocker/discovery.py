"""LAN device discovery: ARP + NDP sweep, reported to the backend."""

from __future__ import annotations

import logging
import random
import socket
import threading
import time
from collections.abc import Callable
from types import SimpleNamespace

from blocker.backend import Seen, report_seen
from blocker.config import Config
from blocker.identity import vendor_for

log = logging.getLogger(__name__)

MAX_IPV6 = 8
MAX_STR = 255


def resolve_hostname(ip: str) -> str | None:
    """Best-effort reverse DNS. Never raises."""
    try:
        return socket.gethostbyaddr(ip)[0] or None
    except Exception:  # noqa: BLE001 - best effort, the daemon keeps running
        return None


def _scapy_send(kind: str, cfg: Config, iface: str | None = None):
    """Real scapy I/O. Returns (answered, unanswered) where answered holds
    (sent, rcv) pairs and rcv exposes `.ip` and `.mac`. iface overrides cfg.lan_iface."""
    from blocker.scapy_lite import ARP, Ether, ICMPv6EchoRequest, IPv6, get_if_addr, srp

    iface = iface or cfg.lan_iface or None
    if kind == "arp":
        net = ".".join(get_if_addr(iface or "eth0").split(".")[:3]) + ".0/24"
        pkt = Ether(dst="ff:ff:ff:ff:ff:ff") / ARP(pdst=net)
        ans, unans = srp(pkt, iface=iface, timeout=2, verbose=0)
        return [(s, SimpleNamespace(ip=r[ARP].psrc, mac=r[ARP].hwsrc)) for s, r in ans], unans
    pkt = Ether(dst="33:33:00:00:00:01") / IPv6(dst="ff02::1") / ICMPv6EchoRequest()
    ans, unans = srp(pkt, iface=iface, timeout=2, multi=True, verbose=0)
    return [(s, SimpleNamespace(ip=r[IPv6].src, mac=r[Ether].src)) for s, r in ans], unans


def _norm(mac: str) -> str:
    return mac.lower()


def scan_once(
    cfg: Config,
    send: Callable = _scapy_send,
    resolve: Callable[[str], str | None] = resolve_hostname,
    vid: int | None = None,
    iface: str | None = None,
    enrich: Callable[[Seen], Seen] = lambda s: s,
) -> list[Seen]:
    v4: dict[str, str] = {}
    for _, rcv in send("arp", cfg, iface)[0]:
        v4[_norm(rcv.mac)] = rcv.ip
    v6: dict[str, list[str]] = {}
    try:
        for _, rcv in send("ndp", cfg, iface)[0]:
            addrs = v6.setdefault(_norm(rcv.mac), [])
            if rcv.ip not in addrs:
                addrs.append(rcv.ip)
    except Exception as e:  # noqa: BLE001 - best effort, the daemon keeps running
        log.warning("ndp sweep failed: %s", e)
    seen_list = []
    for mac, ip in v4.items():
        hostname = resolve(ip)
        vendor = vendor_for(mac)
        seen = enrich(
            Seen(
                mac=mac,
                ip=ip,
                ipv6=v6.get(mac, [])[:MAX_IPV6],
                hostname=hostname[:MAX_STR] if hostname else hostname,
                vendor=vendor[:MAX_STR] if vendor else vendor,
                vid=vid,
                iface=iface,
            )
        )
        report_seen(cfg, seen)
        seen_list.append(seen)
    return seen_list


class Rescanner:
    """Fan a rescan request out to every discovery loop (one wake event each)."""

    def __init__(self) -> None:
        self._events: list[threading.Event] = []
        self._lock = threading.Lock()

    def register(self) -> threading.Event:
        ev = threading.Event()
        with self._lock:
            self._events.append(ev)
        return ev

    def trigger(self) -> None:
        with self._lock:
            for ev in self._events:
                ev.set()


def run_discovery(
    cfg: Config,
    stop: threading.Event,
    on_seen: Callable[[Seen], None] | None = None,
    vid: int | None = None,
    iface: str | None = None,
    enrich: Callable[[Seen], Seen] = lambda s: s,
    wake: threading.Event | None = None,
) -> None:
    """Run periodic ARP/NDP discovery. Pass iface to override cfg.lan_iface.

    Setting `wake` cuts the sleep short; it is cleared as a sweep starts, so rescans
    requested during a sweep coalesce into one extra sweep."""
    wake = wake or threading.Event()
    while not stop.is_set():
        wake.clear()
        try:
            for seen in scan_once(cfg, vid=vid, iface=iface, enrich=enrich):
                if on_seen:
                    on_seen(seen)
        except Exception as e:  # noqa: BLE001 - best effort, the daemon keeps running
            log.warning("scan on %s failed: %s", iface or cfg.lan_iface, e)
        deadline = time.monotonic() + cfg.scan_interval
        deadline += random.uniform(0, min(2.0, cfg.scan_interval * 0.1))
        while not stop.is_set() and not wake.is_set():
            left = deadline - time.monotonic()
            if left <= 0:
                break
            wake.wait(min(left, 0.25))
