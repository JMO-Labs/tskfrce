"""Orchestrator: wires discovery, state, firewall, redirection, portal and reconcile.

Policy-free. It only maps blocked MACs to currently-known IPs and applies the
result. The app owns all policy; this executes it and fails open on shutdown.
"""

from __future__ import annotations

import ipaddress
import logging
import signal
import threading
import time
from collections.abc import Callable
from dataclasses import replace

from blocker import dns_v6
from blocker import firewall as fw
from blocker.api import make_api
from blocker.arp import RedirectionManager, TargetAddrs
from blocker.backend import (
    Seen,
    fetch_state,
    report_hits,
    report_homework_activity,
    report_networks,
    report_resisting,
    report_workarounds,
)
from blocker.config import Config
from blocker.devices_meta import enrich_seen_with_gateway_and_box
from blocker.discovery import run_discovery
from blocker.hits import HitCounter
from blocker.homework import HomeworkGate
from blocker.hw_wiring import HomeworkWiring
from blocker.ifaces import PerAddress, iface_for_ip, lan_addrs, lan_networks
from blocker.multinet import InterfaceManager
from blocker.portal import run_dns, run_http
from blocker.resist import ResistanceCounter, ResistanceWatch, Tally
from blocker.signals import Signals
from blocker.sites import SiteManager
from blocker.sni_gate import run_gate
from blocker.state_store import MAC_RE, StateStore
from blocker.vlan import VlanDetector
from blocker.workaround import WorkaroundCounter

log = logging.getLogger(__name__)

# RFC1918 + link/unique-local: traffic between blocked device and the LAN stays allowed.
DEFAULT_LAN_CIDRS = [
    "192.168.0.0/16",
    "10.0.0.0/8",
    "172.16.0.0/12",
    "fe80::/10",
    "fc00::/7",
]
PORTAL_PORT = 80
PROBE_WAIT = 10.0
ADDR_TTL = 600.0  # seconds a device's addresses stay redirect-worthy


def _in_net(ip: str | None, net) -> bool:
    try:
        return ipaddress.ip_address(ip or "") in net
    except ValueError:
        return False


def _detect_box_ip(cfg: Config) -> str:
    try:
        from blocker.scapy_lite import get_if_addr

        return get_if_addr(cfg.lan_iface or "eth0")
    except Exception:  # noqa: BLE001 - best effort, the daemon keeps running
        return ""


TEST_MESSAGES = {
    "ok": "Success — the device lost internet access while blocked.",
    "unseen": "We haven't seen this device on the network yet, so we couldn't test it.",
    "device": (
        "The device is trying to get around the block. The box is still stopping it, but "
        "someone may have changed its network settings."
    ),
    "quiet": (
        "We couldn't see this device use the internet during the test. Open a video on it "
        "and test again. If you see this again, your router may be stopping the box — check "
        "the router list in the docs."
    ),
}


class Service:
    def __init__(
        self,
        cfg: Config,
        *,
        firewall=fw,
        redirection: RedirectionManager | None = None,
        fetch: Callable[[Config], list[str] | None] | None = None,
        fetch_state: Callable[[Config], dict | None] = fetch_state,
        sites: SiteManager | None = None,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
        lan_cidrs: list[str] | None = None,
        portal_ip: str | None = None,
        watch: ResistanceWatch | None = None,
        report: Callable[[Config, set[str]], bool] = report_resisting,
        report_hits: Callable[[Config, dict[str, int]], bool] = report_hits,
        report_workarounds: Callable[[Config, dict[str, list[str]]], bool] = report_workarounds,
    ) -> None:
        self.cfg = cfg
        self._fw = firewall
        self._using_iface_mgr = cfg.lan_iface == ""
        if self._using_iface_mgr:
            # InterfaceManager will be set up later with on_seen callback after full init
            self._iface_manager: InterfaceManager | None = InterfaceManager(
                cfg, lan_cidrs=lan_cidrs
            )
            self._redir = None  # type: ignore
        else:
            self._iface_manager = None
            self._redir = redirection or RedirectionManager(cfg)
        self._fetch = fetch  # legacy blocked-only fetch; wins over fetch_state when given
        self._fetch_state = fetch_state
        self._listen_only = False
        self._vid_of: dict[str, int | None] = {}  # mac -> vlan it was last seen on
        self._iface_of: dict[
            str, str | None
        ] = {}  # mac -> interface name; None when using LAN_IFACE
        # (mac, vid) -> addresses + time: a MAC seen on another segment stays enforced on each
        self._seg_seen: dict[tuple[str, int | None], tuple[TargetAddrs, float]] = {}
        self._sleep = sleep
        self._clock = clock
        self._lan_cidrs = lan_cidrs or DEFAULT_LAN_CIDRS
        self._network_enforce: dict[str, bool] = {}
        self._sites = sites or SiteManager(cfg, on_seen=self._on_seen, lan_cidrs=self._lan_cidrs)
        self._alerted: set[str] = set()
        self._portal_ip = portal_ip
        # When using InterfaceManager, _watch will be set to None; each interface manages its own
        self._watch = watch if not self._using_iface_mgr else None
        self._report = report
        self._report_hits = report_hits
        self._report_workarounds = report_workarounds
        self._ip_mac: dict[str, str] = {}
        self.hits = HitCounter(self._mac_for_ip)
        self.workarounds = WorkaroundCounter(self._mac_for_ip)
        self.store = StateStore()
        self._devices: dict[str, TargetAddrs] = {}
        # sniffed IPv4 claims per MAC: spoofed/firewalled on top of the known IP until a scan
        # confirms, so a forged ARP/DHCP frame can add targets but never unblock one
        self._claims: dict[str, set[str]] = {}
        self._seen_at: dict[str, float] = {}
        self._lock = threading.Lock()
        self._probing: set[str] = set()  # MACs overlaid by test_block; guarded by _lock
        self._stop = threading.Event()
        self.failed = False  # set when the control API cannot start; main exits non-zero
        self._api = None
        self._api_servers: list = []  # For multi-bind API servers
        self.signals = Signals(cfg)
        self._vlan = VlanDetector(cfg)
        # Homework mode: gate and wiring
        self._gate = HomeworkGate()
        self._wiring = HomeworkWiring(
            self._gate, firewall, self._mac_for_ip, self._ip_for_mac, cfg, self._gateway_ip
        )
        # One callback: gate first, then render, then conntrack (see HomeworkWiring).
        self.store.on_change(
            lambda _: self._wiring.on_state(self.store.homework(), rerender=self._apply)
        )
        # Set on_seen callback for InterfaceManager now that _on_seen is defined
        if self._using_iface_mgr and self._iface_manager:
            self._iface_manager._on_seen = self._on_seen
            self._iface_manager.on_new_ip = self._on_new_ip

    # --- policy application -------------------------------------------------

    def _apply(self, _blocked: set[str] | None = None) -> None:
        # Serialize the whole compute -> apply -> set_targets under one lock and
        # re-read the authoritative set inside it, so concurrent callers
        # (on_change, reconcile, _on_seen) can't apply a stale ruleset last.
        with self._lock:
            if self._using_iface_mgr:
                infra_macs, infra_ips = self._iface_manager.infra()
                site_macs, site_ips = self._sites.infra()
                infra = infra_macs | site_macs
                unsafe = self._unsafe_ips(None) | infra_ips | site_ips
            else:
                lan = self._lan()
                site_macs, site_ips = self._sites.infra()
                infra = site_macs | (
                    {m.lower() for m in (lan.gateway_mac, lan.gateway_mac6, lan.box_mac) if m}
                    if lan
                    else set()
                )
                unsafe = self._unsafe_ips(lan) | site_ips
            # listen-only: nothing is paused anywhere (discovery continues)
            blocked = set() if self._listen_only else set(self.store.current()) | self._probing
            blocked = {m for m in blocked if self._enforced_here(m)}
            skipped = {m for m in blocked if m.lower() in infra}
            if skipped:
                log.warning("refusing to enforce on router/box MACs: %s", sorted(skipped))
                blocked -= skipped
            devs = {m: self._with_claims(m) for m in blocked}
            # Never spoof an address that isn't safely one device's: the gateway's
            # own IP or the box/portal IP. Stripping it here keeps it out of the firewall sets, the
            # redirect targets and the watch — and off the restore path.
            devs, stripped = self._strip_unsafe(devs, unsafe)
            if stripped:
                log.warning("refusing unsafe gateway-side addresses: %s", sorted(stripped))
            v4 = {ip for t in devs.values() for ip in t.v4}
            v6 = {ip for t in devs.values() for ip in t.ip6}
            macs = set(blocked)  # authoritative block key
            # device IPs from the state we already hold the lock for (no re-entry)
            hw_out, hw_back = self._wiring.pairs_for_render(
                {m: t.ip for m, t in devs.items() if t.ip}
            )
            ruleset = fw.render_ruleset(
                v4, v6, macs, self._lan_cidrs, self._portal_ip or "", PORTAL_PORT, hw_out, hw_back
            )
            try:
                self._fw.apply(ruleset)
            except Exception:
                log.exception("firewall apply failed")
            self._ip_mac = {ip: mac for mac, t in devs.items() for ip in (*t.v4, *t.ip6)}
            if self._using_iface_mgr:
                by_iface = self._by_interface(devs)
                self._iface_manager.set_targets(by_iface)
            else:
                base, by_vid = self._by_segment(devs, unsafe)
                self._redir.set_targets(base)
                if self._watch is not None:
                    self._watch.set_watched(base)
                self._sites.set_targets(by_vid)

    def _enforced_here(self, mac: str) -> bool:
        """Per-network "Enforce here" switch (state key "iface:subnet", or bare iface). A missing
        entry means enforce. Devices off the managed networks are left to the existing routing."""
        if not self._network_enforce:
            return True
        ip = self._live_addrs(mac).ip
        nets = lan_networks()
        iface = (
            (self._iface_of.get(mac) or iface_for_ip(ip, nets))
            if self._using_iface_mgr
            else self.cfg.lan_iface
        )
        if iface is None:
            return True
        keys = [f"{n}:{net}" for n, net in nets if n == iface and _in_net(ip, net)] + [iface]
        return next(
            (bool(self._network_enforce[k]) for k in keys if k in self._network_enforce), True
        )

    def _by_segment(self, devs: dict[str, TargetAddrs], unsafe: set[str]):
        """Split targets per segment. A MAC is redirected on every segment it was seen on within
        ADDR_TTL, so showing up on another VLAN never lifts the block where it already was."""
        now = self._clock()
        base: dict[str, TargetAddrs] = {}
        by_vid: dict[int, dict[str, TargetAddrs]] = {}
        for m, latest in devs.items():
            last_vid = self._vid_of.get(m)
            segs = {
                vid: a
                for (mac, vid), (a, at) in self._seg_seen.items()
                if mac == m and now - at <= ADDR_TTL
            }
            segs[last_vid] = latest  # last segment always, with the vetted live addresses
            for vid, a in segs.items():
                if vid != last_vid:
                    a = self._strip_unsafe({m: a}, unsafe)[0][m]
                (base if vid is None else by_vid.setdefault(vid, {}))[m] = a
        self._seg_seen = {k: v for k, v in self._seg_seen.items() if now - v[1] <= ADDR_TTL}
        return base, by_vid

    def _by_interface(self, devs: dict[str, TargetAddrs]) -> dict[str, dict[str, TargetAddrs]]:
        """Targets per managed interface: where discovery saw the device, else the interface whose
        subnet holds its IP. Neither: it isn't on a network we manage, so there's nothing to enforce
        there (never spoof onto other networks)."""
        nets = lan_networks()
        by_iface: dict[str, dict[str, TargetAddrs]] = {}
        for m, a in devs.items():
            iface = self._iface_of.get(m) or iface_for_ip(a.ip, nets)
            if iface is None:
                log.debug("device %s (%s) is on no managed network; not enforcing", m, a.ip)
                continue
            by_iface.setdefault(iface, {})[m] = a
        return by_iface

    def _mac_for_ip(self, ip: str) -> str | None:
        return self._ip_mac.get(ip)

    def _ip_for_mac(self, mac: str) -> str | None:
        """Return the IP of a device by its MAC (from current _devices)."""
        with self._lock:
            dev = self._devices.get(mac)
        return dev.ip if dev else None

    def _gateway_ip(self) -> str | None:
        if self._using_iface_mgr:
            # Return the first available gateway IP from any interface
            try:
                for _, redir, _ in self._iface_manager._managers.values():
                    lan = redir._lanfacts()
                    if lan.gateway_ip:
                        return lan.gateway_ip
            except (OSError, ValueError):
                log.exception("reading gateway from managed interfaces failed")
            return None
        else:
            lan = self._lan()
            return lan.gateway_ip if lan else None

    def _lan(self):
        try:
            return self._redir._lanfacts()
        except Exception:  # noqa: BLE001 - best effort, the daemon keeps running
            return None  # LAN detection failed -> gateway/box facts unknown

    def _live_addrs(self, mac: str) -> TargetAddrs:
        # Keep last-known addresses (a dodging device goes silent), but drop one
        # that is stale AND since reported by a different MAC (IP was reassigned).
        dev = self._devices.get(mac)
        if dev is None:
            return TargetAddrs(mac=mac)
        seen = self._seen_at.get(mac, float("-inf"))  # never timestamped = stale
        if self._clock() - seen <= ADDR_TTL:
            return dev

        def taken(ip: str) -> bool:
            return any(
                o != mac and ip in (d.ip, *d.ip6) and self._seen_at.get(o, 0.0) > seen
                for o, d in self._devices.items()
            )

        return replace(
            dev,
            ip=None if dev.ip and taken(dev.ip) else dev.ip,
            ip6=tuple(i for i in dev.ip6 if not taken(i)),
        )

    def _unsafe_ips(self, lan) -> set[str]:
        """IPs we must not spoof: gateway and portal/box only (duplicates stay enforced)."""
        unsafe: set[str] = set()
        if lan is not None:
            unsafe.update(ip for ip in (lan.gateway_ip, lan.gateway_ip6) if ip)
        if self._portal_ip:
            unsafe.add(self._portal_ip)
        return unsafe

    @staticmethod
    def _strip_unsafe(
        devs: dict[str, TargetAddrs], unsafe: set[str]
    ) -> tuple[dict[str, TargetAddrs], set[str]]:
        """Drop unsafe IPs from each target (ip -> None, filtered ip6). Returns stripped IPs."""
        stripped: set[str] = set()
        out: dict[str, TargetAddrs] = {}
        for mac, t in devs.items():
            ip = t.ip
            if ip and ip in unsafe:
                stripped.add(ip)
                ip = None
            ip6 = tuple(a for a in t.ip6 if a not in unsafe)
            alt = tuple(a for a in t.alt_ip if a not in unsafe)
            stripped.update(set(t.ip6) - set(ip6), set(t.alt_ip) - set(alt))
            same = ip == t.ip and ip6 == t.ip6 and alt == t.alt_ip
            out[mac] = t if same else replace(t, ip=ip, ip6=ip6, alt_ip=alt)
        return out, stripped

    def _enrich(self, seen: Seen) -> Seen:
        """Gateway/box MACs ride on every report so the backend can hide them in setup."""
        lan = self._lan()
        return enrich_seen_with_gateway_and_box(seen, lan.gateway_mac, lan.box_mac) if lan else seen

    def _on_seen(self, seen: Seen) -> None:
        self.signals.note_seen(seen)
        with self._lock:
            self._devices[seen.mac] = TargetAddrs(mac=seen.mac, ip=seen.ip, ip6=tuple(seen.ipv6))
            self._seen_at[seen.mac] = self._clock()
            self._claims.pop(seen.mac, None)  # a scan is the truth: drop unconfirmed claims
            self._vid_of[seen.mac] = seen.vid
            if seen.iface:  # never forget a known interface because a report lacked one
                self._iface_of[seen.mac] = seen.iface
            self._seg_seen[(seen.mac, seen.vid)] = (self._devices[seen.mac], self._clock())
        if seen.mac in self.store.current():
            self._apply(self.store.current())

    def _on_new_ip(self, mac: str, ip: str) -> None:
        """Sniffer saw a blocked MAC claim a new IPv4: spoof + firewall it now, on top of the known
        IP (the frame may be forged; the next scan settles which one is real)."""
        if mac not in self.store.current() or not self._plausible_claim(mac, ip):
            return
        with self._lock:
            self._claims.setdefault(mac, set()).add(ip)
        self._apply(self.store.current())

    def _plausible_claim(self, mac: str, ip: str) -> bool:
        """Only an IP on the device's own subnet that no gateway, box or other device holds."""
        try:
            addr = ipaddress.ip_address(ip)
        except ValueError:
            return False
        with self._lock:
            known = self._devices.get(mac)
            others = {d.ip for m, d in self._devices.items() if m != mac and d.ip}
        nets = [n for _, n in lan_networks()]
        cur = known.ip if known else None
        home = [n for n in nets if _in_net(cur, n)] if cur else nets
        if addr.version != 4 or not any(addr in n for n in home):
            return False
        return ip not in others | {self._gateway_ip(), self._portal_ip}

    def _with_claims(self, mac: str) -> TargetAddrs:
        t = self._live_addrs(mac)
        alt = tuple(sorted(self._claims.get(mac, set()) - {t.ip}))
        return replace(t, alt_ip=alt) if alt else t

    # --- reconcile (poll heals missed pushes) -------------------------------

    def _reconcile_once(self) -> None:
        if self._fetch is not None:
            blocked = self._fetch(self.cfg)
            state = None if blocked is None else {"blocked": blocked}
        else:
            state = self._fetch_state(self.cfg)
        if state is None:  # app unreachable -> keep last state
            return
        self._listen_only = bool(state.get("listen_only", False))
        self._network_enforce = dict(state.get("network_enforce") or {})
        self._sites.sync({int(v) for v in state.get("covered_vlans", [])})
        # always re-applies (listen_only too); keep homework when the source has none
        self.store.set_state(state["blocked"], state.get("homework", self.store.homework()))

    def _reconcile_loop(self) -> None:
        while not self._stop.wait(self.cfg.reconcile_interval):
            try:
                self._reconcile_once()
            except Exception:
                log.exception("reconcile failed")

    # --- resistance report --------------------------------------------------

    def _resist_once(self) -> None:
        # Local `until` first: must not depend on the backend reports below succeeding.
        self._wiring.tick(rerender=self._apply)
        # Always report the full set (even empty) so the backend can clear.
        if self._using_iface_mgr:
            resisting = self._iface_manager.resisting() | self._sites.resisting()
        else:
            resisting = self._watch.counter.resisting() | self._sites.resisting()
        evidence = self._evidence(resisting)
        if evidence:
            ok = self._report(self.cfg, resisting, evidence=evidence)
        else:
            ok = self._report(self.cfg, resisting)
        if ok is not False:  # keep re-sending evidence until a report succeeds
            self._alerted = set(resisting)
        h = self.hits.drain()
        if h:
            self._report_hits(self.cfg, h)
        self._wiring.flush_activity(lambda items: report_homework_activity(self.cfg, items))
        w = self.workarounds.drain()
        if w:
            self._report_workarounds(self.cfg, w)
        if self._using_iface_mgr:  # Report detected networks to backend
            try:
                report_networks(self.cfg, self._iface_manager.networks())
            except Exception:
                log.exception("network report failed")

    def _evidence(self, resisting: set[str]) -> dict[str, list[dict[str, str]]]:
        """Classified frame samples for newly resisting MACs; logs one INFO line per alert."""
        fresh = resisting - self._alerted
        out: dict[str, list[dict[str, str]]] = {}
        for mac in sorted(fresh):
            try:
                src = self._iface_manager if self._using_iface_mgr else self._watch.counter
                ev = src.evidence(mac)
                if not isinstance(ev, list) or not ev:
                    ev = self._sites.evidence(mac)
            except Exception:
                log.debug("evidence lookup failed", exc_info=True)
                continue
            if isinstance(ev, list) and ev:
                out[mac] = ev
                log.info("bypass alert %s: %s", mac, ev)
        return out

    def _resist_loop(self) -> None:
        while not self._stop.wait(self.cfg.resist_interval):
            try:
                self._resist_once()
            except Exception:
                log.exception("resist report failed")

    # --- diagnostics --------------------------------------------------------

    def test_block(self, mac: str) -> dict:
        """Briefly block one MAC, watch its traffic, restore prior state.

        Decision comes from what the box observes, not a box->device ping (which
        a blocked device can still answer on the LAN): internet return traffic for
        it (``from_gateway``) means the device is dodging the block; traffic to the
        box (``to_box``) means the block is working; neither means we saw nothing.
        """
        mac = mac.strip().lower()
        if not MAC_RE.match(mac):  # _probing feeds the nft ruleset text: validate here
            raise ValueError(f"'{mac}' is not a valid MAC address.")
        with self._lock:
            dev = self._devices.get(mac) or TargetAddrs(mac=mac)
        ip, has_ip6 = dev.ip, bool(dev.ip6)
        lan = self._lan()
        # Overlay this MAC on the enforced set; never touch the store, so an app
        # push or reconcile during the wait is never overwritten.
        with self._lock:
            self._probing.add(mac)
        try:
            self._apply()
            if self._watch is not None:
                self._watch.counter.reset(mac)  # count only traffic inside this window
            self._sleep(PROBE_WAIT)
            tally = self._watch.counter.tally(mac) if self._watch is not None else Tally()
        finally:
            with self._lock:
                self._probing.discard(mac)
            self._apply()
        if ip is None:
            reason = "unseen"
        elif tally.from_gateway > 0:
            reason = "device"
        elif tally.to_box > 0:
            reason = "ok"
            if has_ip6 and not (lan and lan.gateway_mac6):
                reason = "quiet"  # can't redirect IPv6 here, so can't claim success
        else:
            reason = "quiet"
        # `reason` is authoritative; `offline` and `router_resisted` are deprecated
        # and kept only for compatibility.
        return {
            "offline": reason in ("ok", "device"),
            "router_resisted": reason == "quiet",
            "reason": reason,
            "message": TEST_MESSAGES[reason],
        }

    # --- lifecycle ----------------------------------------------------------

    def start(self) -> None:
        if self._portal_ip is None:
            self._portal_ip = _detect_box_ip(self.cfg)
        self._spawn(lambda: run_gate(self._stop))
        try:
            self._fw.enable_forwarding()
        except Exception:
            log.exception("enable_forwarding failed")
        if not self._using_iface_mgr and self._watch is None:
            counter = ResistanceCounter(self._redir._lanfacts(), lan_cidrs=self._lan_cidrs)
            self._watch = ResistanceWatch(self.cfg, counter, on_new_ip=self._on_new_ip)
        self._spawn(self._reconcile_loop)
        self._spawn(self._resist_loop)
        if self._using_iface_mgr:
            self._spawn(lambda: self._iface_manager.run(self._stop))
        else:
            self._spawn(
                lambda: run_discovery(self.cfg, self._stop, self._on_seen, enrich=self._enrich)
            )
        if self.cfg.lan_iface or self.cfg.mirror_iface:
            self._spawn(lambda: self._vlan.run(self._stop))
        self._spawn(lambda: self.signals.run_dhcp(self._stop))
        self._spawn(lambda: self.signals.run_mdns(self._stop))
        # One DNS + portal server per LAN address, never 0.0.0.0: the setup hotspot (10.42.0.1)
        # needs :53/:80 for itself, and networks come and go (spec A2/A3).
        self._spawn(lambda: PerAddress(self._serve_portal).run(self._stop))
        self._start_dns_v6()
        # Create API servers for each bind host. If bind_hosts is set, use multi-bind with retry.
        if self.cfg.bind_hosts:
            self._spawn(
                lambda: self._start_api_multi(list(self.cfg.bind_hosts), self.cfg.blocker_port)
            )
        else:
            self._api = make_api(
                self.store,
                self.cfg.internal_token,
                self.test_block,
                self.cfg.bind_host,
                self.cfg.blocker_port,
            )
            self._spawn(self._api.serve_forever)

    def _serve_portal(self, ip: str, stop: threading.Event) -> None:
        """DNS on ip:53 and the kid portal on ip:80 until stop is set."""
        threading.Thread(
            target=run_http,
            args=(self.cfg, stop),
            kwargs={"on_hit": self.hits.add, "host": ip},
            daemon=True,
        ).start()
        run_dns(self.cfg, self._portal_ip or ip, stop, bind=(ip, 53), **self._dns_kw())

    def _dns_kw(self) -> dict:
        return {
            "handle": self._wiring.dns_handle,
            "claims": self._wiring.claims,
            "client_key": self._mac_for_ip,
            "on_query": self.workarounds.add,
        }

    def _start_dns_v6(self, bind: tuple[str, int] = ("::", 53)) -> None:
        kw = self._dns_kw()
        self._spawn(lambda: dns_v6.serve(self.cfg, self._dns_v6_box, self._stop, kw, bind=bind))

    def _dns_v6_box(self) -> str:
        """portal_ip, else (multi-network) the first LAN v4 that PerAddress also serves."""
        if self._portal_ip:
            return self._portal_ip
        return next((ip for _, ip in lan_addrs()), "")

    def _spawn(self, target: Callable[[], None]) -> None:
        threading.Thread(target=target, daemon=True).start()

    def _start_api_multi(self, hosts: list[str], port: int) -> None:
        """Start API servers for multiple bind hosts with retry logic for non-loopback addresses.

        Loopback addresses start immediately; non-loopback addresses retry with exponential
        backoff if they fail (e.g., waiting for the bridge interface). Each host gets its
        own retry thread and is never rebound once listening.
        """
        loopback_hosts = [h for h in hosts if h in ("127.0.0.1", "::1")]
        bridge_hosts = [h for h in hosts if h not in ("127.0.0.1", "::1")]

        # Start loopback immediately (must work or fail fast)
        for host in loopback_hosts:
            try:
                server = make_api(
                    self.store,
                    self.cfg.internal_token,
                    self.test_block,
                    host,
                    port,
                )
                self._api_servers.append(server)
                self._spawn(server.serve_forever)
                log.info("API server started on loopback %s:%d", host, server.server_address[1])
            except OSError:
                log.exception("failed to bind API to loopback %s; stopping service", host)
                self.failed = True
                self.stop()  # heal + delete table, then main exits non-zero so Docker restarts us
                return

        # Retry non-loopback hosts with individual backoff threads
        for host in bridge_hosts:
            self._spawn(lambda h=host, p=port: self._retry_api_bind(h, p))

    def _retry_api_bind(self, host: str, port: int) -> None:
        """Retry binding to a single non-loopback host with exponential backoff.

        Runs in a daemon thread; gives up if service stops.
        """
        backoff = 0.1  # start with 100ms
        max_backoff = 30.0  # cap at 30s between retries

        while True:
            try:
                server = make_api(
                    self.store,
                    self.cfg.internal_token,
                    self.test_block,
                    host,
                    port,
                )
                self._api_servers.append(server)
                self._spawn(server.serve_forever)
                log.info(
                    "API server started on bridge %s:%d (after retry)",
                    host,
                    server.server_address[1],
                )
                return
            except OSError as e:
                log.warning("failed to bind API to %s (will retry in %.1fs): %s", host, backoff, e)
                if self._stop.wait(backoff):
                    log.info("service stopping, giving up on %s", host)
                    return
                backoff = min(backoff * 1.5, max_backoff)

    def run(self) -> None:
        self.start()
        self._stop.wait()

    def stop(self) -> None:
        self._stop.set()
        # Stop redirection and resistance watches before flushing firewall
        if self._using_iface_mgr:
            # Synchronously stop all per-interface managers before flush
            if self._iface_manager:
                with self._iface_manager._lock:
                    for iface in list(self._iface_manager._managers):
                        _stop_ev, redir, watch = self._iface_manager._managers.pop(iface)
                        try:
                            redir.stop_all()
                        except Exception:
                            log.exception("redirection restore failed on %s", iface)
                        if watch is not None:
                            try:
                                watch.stop()
                            except Exception:
                                log.exception("resistance watch stop failed on %s", iface)
        else:
            if self._watch is not None:
                try:
                    self._watch.stop()
                except Exception:
                    log.exception("resistance watch stop failed")
            try:
                self._redir.stop_all()
            except Exception:
                log.exception("redirection restore failed")
        try:
            self._sites.stop_all()
        except Exception:
            log.exception("site restore failed")
        try:
            self._fw.flush()  # fail open
        except Exception:
            log.exception("firewall flush failed")
        if self._api is not None:
            try:
                self._api.shutdown()
            except Exception:  # noqa: BLE001, S110 - best effort shutdown
                pass
        for server in self._api_servers:
            try:
                server.shutdown()
            except Exception:  # noqa: BLE001, S110 - best effort shutdown
                pass


def main() -> None:
    import os

    logging.basicConfig(level=logging.INFO)
    cfg = Config.from_env(os.environ)
    svc = Service(cfg)
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: svc.stop())
    svc.run()
    if svc.failed:
        raise SystemExit(1)
