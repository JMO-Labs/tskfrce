"""Orchestrator: wires discovery, state, firewall, redirection, portal and reconcile.

Policy-free. It only maps blocked MACs to currently-known IPs and applies the
result. The app owns all policy; this executes it and fails open on shutdown.
"""

from __future__ import annotations

import logging
import signal
import threading
import time
from collections.abc import Callable
from dataclasses import replace

from blocker import firewall as fw
from blocker.api import make_api
from blocker.arp import RedirectionManager, TargetAddrs
from blocker.backend import (
    Seen,
    fetch_state,
    report_hits,
    report_homework_activity,
    report_resisting,
    report_workarounds,
)
from blocker.config import Config
from blocker.discovery import run_discovery
from blocker.hits import HitCounter
from blocker.homework import HomeworkGate
from blocker.hw_wiring import HomeworkWiring
from blocker.portal import run_dns, run_http
from blocker.resist import ResistanceCounter, ResistanceWatch, Tally
from blocker.signals import Signals
from blocker.sites import SiteManager
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


def _detect_box_ip(cfg: Config) -> str:
    try:
        from scapy.all import get_if_addr

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
        self._redir = redirection or RedirectionManager(cfg)
        self._fetch = fetch  # legacy blocked-only fetch; wins over fetch_state when given
        self._fetch_state = fetch_state
        self._listen_only = False
        self._vid_of: dict[str, int | None] = {}  # mac -> vlan it was last seen on
        # (mac, vid) -> addresses + time: a MAC seen on another segment stays enforced on each
        self._seg_seen: dict[tuple[str, int | None], tuple[TargetAddrs, float]] = {}
        self._sleep = sleep
        self._clock = clock
        self._lan_cidrs = lan_cidrs or DEFAULT_LAN_CIDRS
        self._sites = sites or SiteManager(cfg, on_seen=self._on_seen, lan_cidrs=self._lan_cidrs)
        self._portal_ip = portal_ip
        self._watch = watch
        self._report = report
        self._report_hits = report_hits
        self._report_workarounds = report_workarounds
        self._ip_mac: dict[str, str] = {}
        self.hits = HitCounter(self._mac_for_ip)
        self.workarounds = WorkaroundCounter(self._mac_for_ip)
        self.store = StateStore()
        self._devices: dict[str, TargetAddrs] = {}
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

    # --- policy application -------------------------------------------------

    def _apply(self, _blocked: set[str] | None = None) -> None:
        # Serialize the whole compute -> apply -> set_targets under one lock and
        # re-read the authoritative set inside it, so concurrent callers
        # (on_change, reconcile, _on_seen) can't apply a stale ruleset last.
        with self._lock:
            lan = self._lan()
            site_macs, site_ips = self._sites.infra()
            infra = site_macs | (
                {m.lower() for m in (lan.gateway_mac, lan.gateway_mac6, lan.box_mac) if m}
                if lan
                else set()
            )
            # listen-only: nothing is paused anywhere (discovery continues)
            blocked = set() if self._listen_only else set(self.store.current()) | self._probing
            skipped = {m for m in blocked if m.lower() in infra}
            if skipped:
                log.warning("refusing to enforce on router/box MACs: %s", sorted(skipped))
                blocked -= skipped
            devs = {m: self._live_addrs(m) for m in blocked}
            # Never spoof an address that isn't safely one device's: the gateway's
            # own IP or the box/portal IP. Stripping it here keeps it out of the firewall sets, the
            # redirect targets and the watch — and off the restore path.
            unsafe = self._unsafe_ips(lan) | site_ips
            devs, stripped = self._strip_unsafe(devs, unsafe)
            if stripped:
                log.warning("refusing unsafe gateway-side addresses: %s", sorted(stripped))
            v4 = {t.ip for t in devs.values() if t.ip}
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
            self._ip_mac = {ip: mac for mac, t in devs.items() for ip in (t.ip, *t.ip6) if ip}
            base, by_vid = self._by_segment(devs, unsafe)
            self._redir.set_targets(base)
            if self._watch is not None:
                self._watch.set_watched(base)
            self._sites.set_targets(by_vid)

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

    def _mac_for_ip(self, ip: str) -> str | None:
        return self._ip_mac.get(ip)

    def _ip_for_mac(self, mac: str) -> str | None:
        """Return the IP of a device by its MAC (from current _devices)."""
        with self._lock:
            dev = self._devices.get(mac)
        return dev.ip if dev else None

    def _gateway_ip(self) -> str | None:
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
            stripped.update(set(t.ip6) - set(ip6))
            out[mac] = t if (ip == t.ip and ip6 == t.ip6) else replace(t, ip=ip, ip6=ip6)
        return out, stripped

    def _on_seen(self, seen: Seen) -> None:
        self.signals.note_seen(seen)
        with self._lock:
            self._devices[seen.mac] = TargetAddrs(mac=seen.mac, ip=seen.ip, ip6=tuple(seen.ipv6))
            self._seen_at[seen.mac] = self._clock()
            self._vid_of[seen.mac] = seen.vid
            self._seg_seen[(seen.mac, seen.vid)] = (self._devices[seen.mac], self._clock())
        if seen.mac in self.store.current():
            self._apply(self.store.current())

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
        self._report(self.cfg, self._watch.counter.resisting() | self._sites.resisting())
        h = self.hits.drain()
        if h:
            self._report_hits(self.cfg, h)
        self._wiring.flush_activity(lambda items: report_homework_activity(self.cfg, items))
        w = self.workarounds.drain()
        if w:
            self._report_workarounds(self.cfg, w)

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
        try:
            self._fw.enable_forwarding()
        except Exception:
            log.exception("enable_forwarding failed")
        if self._watch is None:
            counter = ResistanceCounter(self._redir._lanfacts(), lan_cidrs=self._lan_cidrs)
            self._watch = ResistanceWatch(self.cfg, counter)
        self._spawn(self._reconcile_loop)
        self._spawn(self._resist_loop)
        self._spawn(lambda: run_discovery(self.cfg, self._stop, self._on_seen))
        if self.cfg.lan_iface or self.cfg.mirror_iface:
            self._spawn(lambda: self._vlan.run(self._stop))
        self._spawn(lambda: self.signals.run_dhcp(self._stop))
        self._spawn(lambda: self.signals.run_mdns(self._stop))
        self._spawn(
            lambda: run_dns(
                self.cfg,
                self._portal_ip or "",
                self._stop,
                handle=self._wiring.dns_handle,
                claims=self._wiring.claims,
                client_key=self._mac_for_ip,
                on_query=self.workarounds.add,
            )
        )
        self._spawn(lambda: run_http(self.cfg, self._stop, on_hit=self.hits.add))
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
        if self._watch is not None:
            try:
                self._watch.stop()
            except Exception:
                log.exception("resistance watch stop failed")
        try:
            self._sites.stop_all()
        except Exception:
            log.exception("site restore failed")
        try:
            self._redir.stop_all()
        except Exception:
            log.exception("redirection restore failed")
        finally:
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
