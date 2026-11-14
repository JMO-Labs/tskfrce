"""Passive device signals: DHCP fingerprint and mDNS name/model (both passive scapy sniffs).

Best-effort: failures are logged, never raised. A signal is reported to the
backend only when it first appears or changes for a MAC.
"""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable
from dataclasses import replace

from blocker.backend import Seen, report_seen
from blocker.config import Config

log = logging.getLogger(__name__)

# Services whose answers carry a device's own name/model (Apple, Android TV, printers, etc.).
MDNS_TYPES = (
    "_device-info._tcp.local.",
    "_companion-link._tcp.local.",
    "_airplay._tcp.local.",
)
MDNS_QUERY_EVERY = 300  # s
_FIELDS = ("mdns_name", "model", "dhcp_fp", "dhcp_hostname")
_FRESH = 600  # s: only trust discovery entries this recent for IP -> MAC


def dhcp_fp_from_packet(pkt) -> tuple[str, str] | None:
    """(client mac, '1,121,3,...') from a DHCP packet, else None. Never raises."""
    try:
        from blocker.scapy_lite import BOOTP, DHCP, Ether

        if not (pkt.haslayer(DHCP) and pkt.haslayer(BOOTP)):
            return None
        prl = next((o[1] for o in pkt[DHCP].options if o[0] == "param_req_list"), None)
        if not prl:
            return None
        if isinstance(prl, int):
            prl = [prl]
        fp = ",".join(str(int(x)) for x in prl)
        if pkt[BOOTP].op != 1 or not pkt.haslayer(Ether):  # BOOTREQUEST from the client only
            return None
        mac = ":".join(f"{b:02x}" for b in bytes(pkt[BOOTP].chaddr)[:6])
        if pkt[Ether].src.lower() != mac:  # relayed or spoofed: sender is not the client
            return None
        return mac, fp
    except Exception:  # noqa: BLE001 - best effort, the daemon keeps running
        return None


def _clean_hostname(raw) -> str | None:
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8", "replace")
    if not isinstance(raw, str):
        return None
    s = "".join(c for c in raw if c.isprintable() and c != "\ufffd").strip()
    return s[:63] or None


def dhcp_hostname_from_packet(pkt) -> tuple[str, str] | None:
    """(client mac, hostname) from option 12, else the host part of option 81. Never raises."""
    try:
        from blocker.scapy_lite import BOOTP, DHCP, Ether

        if not (pkt.haslayer(DHCP) and pkt.haslayer(BOOTP) and pkt.haslayer(Ether)):
            return None
        if pkt[BOOTP].op != 1:
            return None
        mac = ":".join(f"{b:02x}" for b in bytes(pkt[BOOTP].chaddr)[:6])
        if pkt[Ether].src.lower() != mac:
            return None
        opts = {o[0]: o[1] for o in pkt[DHCP].options if isinstance(o, tuple) and len(o) > 1}
        name = _clean_hostname(opts.get("hostname"))
        if name is None and isinstance(opts.get("client_FQDN"), bytes):
            raw = opts["client_FQDN"]
            if len(raw) > 3 and raw[0] & 0x04:  # RFC 4702 E flag: canonical wire format
                n = raw[3]
                name = _clean_hostname(raw[4 : 4 + n]) if n and 4 + n <= len(raw) else None
            else:
                fqdn = _clean_hostname(raw[3:])  # skip flags + 2 rcode bytes
                name = _clean_hostname(fqdn.split(".")[0]) if fqdn else None
        return (mac, name) if name else None
    except Exception:  # noqa: BLE001 - best effort, the daemon keeps running
        return None


def _text(v) -> str | None:
    if isinstance(v, bytes):
        v = v.decode("utf-8", "replace")
    return v or None if isinstance(v, str) or v is None else str(v)


def mdns_from_packet(pkt) -> tuple[str, str, str | None] | None:
    """(sender mac, host, model) from an mDNS response whose A record matches the
    packet's IP source, else None. Never raises."""
    try:
        from blocker.scapy_lite import DNS, IP, Ether

        if not (pkt.haslayer(Ether) and pkt.haslayer(IP) and pkt.haslayer(DNS)):
            return None
        dns = pkt[DNS]
        if dns.qr != 1:
            return None
        src = pkt[IP].src
        recs = [r for sec in (dns.an, dns.ar) if sec for r in sec]
        host = model = None
        for r in recs:
            if r.type == 1 and _text(r.rdata) == src and host is None:
                host = (_text(r.rrname) or "").rstrip(".").removesuffix(".local") or None
        if host is None:
            return None
        for r in recs:
            if r.type == 16:
                for item in r.rdata if isinstance(r.rdata, list) else [r.rdata]:
                    k, _, v = (_text(item) or "").partition("=")
                    if k in ("model", "md") and v and (model is None or k == "model"):
                        model = v
        return pkt[Ether].src.lower(), host, model
    except Exception:  # noqa: BLE001 - best effort, the daemon keeps running
        return None


def _managed_ifaces() -> list[str]:
    """Interfaces discovery/multinet manage (same source: lan_networks), de-duplicated."""
    from blocker.ifaces import lan_networks

    return list(dict.fromkeys(name for name, _ in lan_networks()))


class Signals:
    def __init__(
        self,
        cfg: Config,
        report: Callable[[Config, Seen], object] = report_seen,
        ifaces: Callable[[], list[str]] = _managed_ifaces,
    ):
        self.cfg = cfg
        self._ifaces = ifaces
        self._report = report
        self._lock = threading.Lock()
        self._latest: dict[str, Seen] = {}  # last discovery result per MAC
        self._seen_at: dict[str, float] = {}
        self._cache: dict[str, dict[str, str]] = {}  # reported signals per MAC

    def note_seen(self, seen: Seen) -> None:
        with self._lock:
            self._latest[seen.mac] = seen
            self._seen_at[seen.mac] = time.monotonic()

    def mac_for_ip(self, ip: str) -> str | None:
        """The one recently-seen MAC holding this IP; None if stale or ambiguous."""
        cutoff = time.monotonic() - _FRESH
        with self._lock:
            macs = [m for m, s in self._latest.items() if s.ip == ip and self._seen_at[m] >= cutoff]
        return macs[0] if len(macs) == 1 else None

    def update(self, mac: str, **sig: str | None) -> bool:
        """Cache new/changed signals and report merged with last-known data."""
        sig = {k: v[:255] for k, v in sig.items() if k in _FIELDS and v}
        with self._lock:
            base = self._latest.get(mac)
            if base is None:  # only enrich devices discovery already knows
                return False
            cached = self._cache.setdefault(mac, {})
            if not sig or all(cached.get(k) == v for k, v in sig.items()):
                return False
            cached.update(sig)
            seen = replace(base, **cached)
        self._report(self.cfg, seen)
        return True

    # --- DHCP ---------------------------------------------------------------

    def _on_dhcp(self, pkt) -> None:
        fp = dhcp_fp_from_packet(pkt)
        if fp:
            self.update(fp[0], dhcp_fp=fp[1])
        hn = dhcp_hostname_from_packet(pkt)
        if hn:
            self.update(hn[0], dhcp_hostname=hn[1])

    def _managed(self) -> list[str]:
        if self.cfg.lan_iface:  # single-interface mode: only the enforced iface
            return [self.cfg.lan_iface]
        return self._ifaces()

    def _make_sniffer(self, iface: str, filt: str, prn):
        from blocker.scapy_lite import AsyncSniffer

        return AsyncSniffer(iface=iface, filter=filt, store=False, prn=prn)

    def _sniff_managed(self, stop: threading.Event, filt: str, prn, every: float = 30) -> None:
        """Keep one sniffer per managed interface (never the scapy default), following changes."""
        running: dict[str, object] = {}
        try:
            while True:
                want = set(self._managed())
                for name in set(running) - want:
                    self._stop_sniffer(running.pop(name))
                for name in want - set(running):
                    try:
                        sn = self._make_sniffer(name, filt, prn)
                        sn.start()
                        running[name] = sn
                    except Exception as e:  # noqa: BLE001 - one bad iface must not stop the rest
                        log.warning("sniff on %s failed: %s", name, e)
                if stop.wait(every):
                    break
        finally:
            for sn in running.values():
                self._stop_sniffer(sn)

    @staticmethod
    def _stop_sniffer(sn) -> None:
        try:
            sn.stop()
        except Exception as e:  # noqa: BLE001
            log.debug("sniffer stop failed: %s", e)

    def run_dhcp(self, stop: threading.Event) -> None:
        try:
            self._sniff_managed(stop, "udp and (port 67 or 68)", self._on_dhcp)
        except Exception as e:  # noqa: BLE001 - best effort, the daemon keeps running
            log.warning("dhcp sniff stopped: %s", e)

    # --- mDNS ---------------------------------------------------------------

    def _on_mdns(self, pkt) -> None:
        try:
            got = mdns_from_packet(pkt)
            if got and self.mac_for_ip(pkt["IP"].src) == got[0]:
                self.update(got[0], mdns_name=got[1], model=got[2])
        except Exception as e:  # noqa: BLE001 - best effort, the daemon keeps running
            log.warning("mdns packet failed: %s", e)

    def run_mdns(self, stop: threading.Event) -> None:
        """Sniff mDNS responses; ask the LAN every MDNS_QUERY_EVERY s so quiet devices answer."""
        try:
            t = threading.Thread(
                target=self._sniff_managed,
                args=(stop, "udp port 5353", self._on_mdns),
                daemon=True,
            )
            t.start()
            while True:
                self._query_mdns()
                if stop.wait(MDNS_QUERY_EVERY):
                    break
            t.join(timeout=5)
        except Exception as e:  # noqa: BLE001 - best effort, the daemon keeps running
            log.warning("mdns sniff stopped: %s", e)

    def _query_mdns(self) -> None:
        """One multicast PTR query; answers are multicast too, so the sniffer sees them."""
        try:
            from blocker.scapy_lite import DNS, DNSQR, IP, UDP, send

            qd = [DNSQR(qname=t, qtype="PTR") for t in MDNS_TYPES]
            pkt = IP(dst="224.0.0.251", ttl=255) / UDP(sport=5353, dport=5353) / DNS(qd=qd)
            for iface in self._managed():
                try:
                    send(pkt, iface=iface, verbose=False)
                except Exception as e:  # noqa: BLE001 - other interfaces still get the query
                    log.warning("mdns query on %s failed: %s", iface, e)
        except Exception as e:  # noqa: BLE001 - best effort, the daemon keeps running
            log.warning("mdns query failed: %s", e)
