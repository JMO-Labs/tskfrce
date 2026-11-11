"""Tagged-VLAN detection (802.1Q) on the trunk (LAN_IFACE) and optional mirror port.

Receive-only: nothing here ever transmits, so MIRROR_IFACE is safe on a SPAN port.
Distinct source MACs and a /24 guess (from ARP sender IPs) are tallied per vid and
reported to the backend. Passive observations feed ONLY the tally: device rows on a
VLAN come from that site's own discovery, never from sniffed (spoofable) frames.
"""

from __future__ import annotations

import ipaddress
import logging
import threading
from collections import Counter
from collections.abc import Callable
from typing import Any

from blocker.backend import report_vlans
from blocker.config import Config

log = logging.getLogger(__name__)

REPORT_INTERVAL = 60.0


def vlan_of(pkt: Any) -> tuple[int, str, str | None] | None:
    """(vid, src mac, ARP sender ip) of a tagged frame; None if untagged or unparsable."""
    try:
        from blocker.scapy_lite import ARP, Dot1Q, Ether

        if not pkt.haslayer(Dot1Q) or not pkt.haslayer(Ether):
            return None
        vid = int(pkt[Dot1Q].vlan)
        if not 1 <= vid <= 4094:  # 0 = priority tag only, not a VLAN
            return None
        ip = None
        if pkt.haslayer(ARP):
            ip = _trusted_ip(pkt[ARP], str(pkt[Ether].src))
        return vid, str(pkt[Ether].src).lower(), ip
    except Exception:  # noqa: BLE001 - best effort, the daemon keeps running
        return None


def _trusted_ip(arp: Any, eth_src: str) -> str | None:
    """ARP sender IP only if the frame isn't spoofed (Ether.src == hwsrc) and is private."""
    if str(arp.hwsrc).lower() != eth_src.lower():
        return None
    try:
        a = ipaddress.ip_address(str(arp.psrc))
    except ValueError:
        return None
    ok = a.version == 4 and a.is_private and not (a.is_unspecified or a.is_link_local)
    return str(a) if ok else None


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
    from blocker.scapy_lite import AsyncSniffer

    s = AsyncSniffer(iface=iface, filter="vlan", prn=prn, store=False)
    s.start()
    return s


class VlanDetector:
    def __init__(
        self,
        cfg: Config,
        *,
        report_vlans: Callable[[Config, list[dict]], bool] = report_vlans,
        sniffer_factory: Callable[..., Any] = _real_sniffer,
    ) -> None:
        self.cfg = cfg
        self.tally = VlanTally()
        self._report_vlans = report_vlans
        self._factory = sniffer_factory
        self._sniffers: list[Any] = []

    def on_packet(self, pkt: Any) -> None:
        got = vlan_of(pkt)
        if got is None:
            return
        vid, mac, ip = got
        self.tally.observe(vid, mac, ip)

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
