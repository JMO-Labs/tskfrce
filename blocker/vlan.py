"""Tagged-VLAN detection (802.1Q) on the trunk (LAN_IFACE) and optional mirror port.

Receive-only: nothing here ever transmits, so MIRROR_IFACE is safe on a SPAN port.
Distinct source MACs and a /24 guess (from ARP sender IPs) are tallied per vid and
reported to the backend; devices seen on a tagged VLAN are reported with their vid.
"""

from __future__ import annotations

import ipaddress
import logging
import threading
import time
from collections import Counter
from collections.abc import Callable
from typing import Any

from blocker.backend import Seen, report_seen, report_vlans
from blocker.config import Config

log = logging.getLogger(__name__)

REPORT_INTERVAL = 60.0
SEEN_INTERVAL = 300.0  # per-MAC device report rate limit


def vlan_of(pkt: Any) -> tuple[int, str, str | None] | None:
    """(vid, src mac, ARP sender ip) of a tagged frame; None if untagged or unparsable."""
    try:
        from scapy.layers.l2 import ARP, Dot1Q, Ether

        if not pkt.haslayer(Dot1Q) or not pkt.haslayer(Ether):
            return None
        vid = int(pkt[Dot1Q].vlan)
        if not 1 <= vid <= 4094:  # 0 = priority tag only, not a VLAN
            return None
        ip = None
        if pkt.haslayer(ARP):
            psrc = str(pkt[ARP].psrc)
            ip = psrc if psrc != "0.0.0.0" else None
        return vid, str(pkt[Ether].src).lower(), ip
    except Exception:
        return None


def _subnet24(ip: str) -> str | None:
    try:
        a = ipaddress.ip_address(ip)
    except ValueError:
        return None
    if a.version != 4 or a.is_link_local or a.is_unspecified or a.is_multicast:
        return None
    return str(ipaddress.ip_network(f"{ip}/24", strict=False))


class VlanTally:
    """Thread-safe per-vid distinct MACs and /24 votes."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._macs: dict[int, set[str]] = {}
        self._nets: dict[int, Counter] = {}

    def observe(self, vid: int, mac: str, ip: str | None = None) -> None:
        net = _subnet24(ip) if ip else None
        with self._lock:
            self._macs.setdefault(vid, set()).add(mac)
            if net:
                self._nets.setdefault(vid, Counter())[net] += 1

    def snapshot(self) -> list[dict]:
        with self._lock:
            out = []
            for vid in sorted(self._macs):
                votes = self._nets.get(vid)
                out.append(
                    {
                        "vid": vid,
                        "macs": len(self._macs[vid]),
                        "subnet": votes.most_common(1)[0][0] if votes else None,
                    }
                )
            return out


def _real_sniffer(*, iface: str, prn: Callable) -> Any:
    from scapy.all import AsyncSniffer

    s = AsyncSniffer(iface=iface, filter="vlan", prn=prn, store=False)
    s.start()
    return s


class VlanDetector:
    def __init__(
        self,
        cfg: Config,
        *,
        report_vlans: Callable[[Config, list[dict]], bool] = report_vlans,
        report_seen: Callable[[Config, Seen], object] = report_seen,
        sniffer_factory: Callable[..., Any] = _real_sniffer,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.cfg = cfg
        self.tally = VlanTally()
        self._report_vlans = report_vlans
        self._report_seen = report_seen
        self._factory = sniffer_factory
        self._clock = clock
        self._sniffers: list[Any] = []
        self._last_seen: dict[tuple[int, str], float] = {}

    def on_packet(self, pkt: Any) -> None:
        got = vlan_of(pkt)
        if got is None:
            return
        vid, mac, ip = got
        self.tally.observe(vid, mac, ip)
        now = self._clock()
        key = (vid, mac)
        if ip and now - self._last_seen.get(key, float("-inf")) >= SEEN_INTERVAL:
            self._last_seen[key] = now
            self._report_seen(
                self.cfg, Seen(mac=mac, ip=ip, ipv6=[], hostname=None, vendor=None, vid=vid)
            )

    def report_once(self) -> None:
        vlans = self.tally.snapshot()
        if vlans:
            self._report_vlans(self.cfg, vlans)

    def start(self) -> None:
        for iface in (self.cfg.lan_iface, self.cfg.mirror_iface):
            if not iface:
                continue
            try:
                self._sniffers.append(self._factory(iface=iface, prn=self.on_packet))
            except Exception:
                log.exception("vlan sniffer failed on %s", iface)

    def stop(self) -> None:
        for s in self._sniffers:
            try:
                s.stop()
            except Exception:
                log.debug("vlan sniffer stop failed", exc_info=True)
        self._sniffers = []

    def run(self, stop: threading.Event) -> None:
        self.start()
        try:
            while not stop.wait(REPORT_INTERVAL):
                try:
                    self.report_once()
                except Exception:
                    log.exception("vlan report failed")
        finally:
            self.stop()
