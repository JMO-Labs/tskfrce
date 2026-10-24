"""Passive device signals: DHCP fingerprint (scapy) and mDNS name/model (zeroconf).

Best-effort: failures are logged, never raised. A signal is reported to the
backend only when it first appears or changes for a MAC.
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable
from dataclasses import replace

from blocker.backend import Seen, report_seen
from blocker.config import Config

log = logging.getLogger(__name__)

MDNS_TYPES = (
    "_device-info._tcp.local.",
    "_companion-link._tcp.local.",
    "_airplay._tcp.local.",
)
_FIELDS = ("mdns_name", "model", "dhcp_fp")


def dhcp_fp_from_packet(pkt) -> tuple[str, str] | None:
    """(client mac, '1,121,3,...') from a DHCP packet, else None. Never raises."""
    try:
        from scapy.all import BOOTP, DHCP, Ether

        if not (pkt.haslayer(DHCP) and pkt.haslayer(BOOTP)):
            return None
        prl = next((o[1] for o in pkt[DHCP].options if o[0] == "param_req_list"), None)
        if not prl:
            return None
        if isinstance(prl, int):
            prl = [prl]
        fp = ",".join(str(int(x)) for x in prl)
        mac = pkt[Ether].src if pkt.haslayer(Ether) else None
        if not mac:
            chaddr = bytes(pkt[BOOTP].chaddr)[:6]
            mac = ":".join(f"{b:02x}" for b in chaddr)
        return mac.lower(), fp
    except Exception:
        return None


def _text(v) -> str | None:
    if isinstance(v, bytes):
        v = v.decode("utf-8", "replace")
    return v or None if isinstance(v, str) or v is None else str(v)


def mdns_from_info(server, properties, addresses) -> tuple[str | None, str | None, list[str]]:
    """(name, model, ipv4 list) from a resolved service. Never raises."""
    try:
        name = _text(server)
        if name:
            name = name.rstrip(".").removesuffix(".local") or None
        model = None
        for k, v in (properties or {}).items():
            if _text(k) == "model":
                model = _text(v)
        ips = []
        for a in addresses or []:
            if isinstance(a, bytes) and len(a) == 4:
                ips.append(".".join(str(b) for b in a))
            elif isinstance(a, str):
                ips.append(a)
        return name, model, ips
    except Exception:
        return None, None, []


class Signals:
    def __init__(self, cfg: Config, report: Callable[[Config, Seen], object] = report_seen):
        self.cfg = cfg
        self._report = report
        self._lock = threading.Lock()
        self._latest: dict[str, Seen] = {}  # last discovery result per MAC
        self._cache: dict[str, dict[str, str]] = {}  # reported signals per MAC

    def note_seen(self, seen: Seen) -> None:
        with self._lock:
            self._latest[seen.mac] = seen

    def mac_for_ip(self, ip: str) -> str | None:
        with self._lock:
            return next((m for m, s in self._latest.items() if s.ip == ip), None)

    def update(self, mac: str, **sig: str | None) -> bool:
        """Cache new/changed signals and report merged with last-known data."""
        sig = {k: v[:255] for k, v in sig.items() if k in _FIELDS and v}
        with self._lock:
            cached = self._cache.setdefault(mac, {})
            if not sig or all(cached.get(k) == v for k, v in sig.items()):
                return False
            cached.update(sig)
            base = self._latest.get(mac) or Seen(
                mac=mac, ip=None, ipv6=[], hostname=None, vendor=None
            )
            seen = replace(base, **cached)
        self._report(self.cfg, seen)
        return True

    # --- DHCP ---------------------------------------------------------------

    def _on_dhcp(self, pkt) -> None:
        got = dhcp_fp_from_packet(pkt)
        if got:
            self.update(got[0], dhcp_fp=got[1])

    def run_dhcp(self, stop: threading.Event) -> None:
        try:
            from scapy.all import sniff

            sniff(
                iface=self.cfg.lan_iface or None,
                filter="udp and (port 67 or 68)",
                store=False,
                prn=self._on_dhcp,
                stop_filter=lambda _p: stop.is_set(),
            )
        except Exception as e:
            log.warning("dhcp sniff stopped: %s", e)

    # --- mDNS ---------------------------------------------------------------

    def _on_service(self, zc, type_: str, name: str) -> None:
        try:
            info = zc.get_service_info(type_, name, timeout=3000)
            if info is None:
                return
            host, model, ips = mdns_from_info(info.server, info.properties, info.addresses)
            for ip in ips:
                mac = self.mac_for_ip(ip)
                if mac:
                    self.update(mac, mdns_name=host, model=model)
        except Exception as e:
            log.warning("mdns service %s failed: %s", name, e)

    def run_mdns(self, stop: threading.Event) -> None:
        zc = None
        try:
            from zeroconf import ServiceBrowser, Zeroconf

            def handler(zeroconf, service_type, name, state_change):
                # Resolve off zeroconf's event loop thread.
                threading.Thread(
                    target=self._on_service, args=(zeroconf, service_type, name), daemon=True
                ).start()

            zc = Zeroconf()
            browsers = [ServiceBrowser(zc, t, handlers=[handler]) for t in MDNS_TYPES]
            stop.wait()
            for b in browsers:
                b.cancel()
        except Exception as e:
            log.warning("mdns browser stopped: %s", e)
        finally:
            if zc is not None:
                try:
                    zc.close()
                except Exception:
                    pass
