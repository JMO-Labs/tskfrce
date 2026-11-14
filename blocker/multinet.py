"""Multi-interface support when LAN_IFACE is unset (spec A2).

Tracks and manages discovery/redirection/resistance per auto-detected interface.
Similar to SiteManager but for base interfaces instead of VLANs.
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable
from dataclasses import replace
from typing import Any

from blocker.arp import LanFacts, RedirectionManager, TargetAddrs
from blocker.config import Config
from blocker.devices_meta import enrich_seen_with_gateway_and_box
from blocker.discovery import Rescanner, run_discovery
from blocker.ifaces import lan_addrs
from blocker.resist import ResistanceCounter, ResistanceWatch

log = logging.getLogger(__name__)


def detect_iface_gateway(iface: str) -> LanFacts:
    """Detect IPv4 and IPv6 gateways for a specific interface."""
    import subprocess

    from blocker.scapy_lite import ARP, Ether, get_if_hwaddr, srp

    box_mac = get_if_hwaddr(iface)
    gateway_ip = None
    gateway_mac = None
    gateway_ip6 = None
    gateway_mac6 = None

    # IPv4: Get default gateway IP for this interface
    try:
        result = subprocess.run(
            ["ip", "-4", "route", "show", "default", "dev", iface],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        lines = result.stdout.strip().split("\n")
        if lines and lines[0]:
            gateway_ip = lines[0].split()[2]  # "default via <ip> dev <iface>"
    except Exception:
        log.exception("failed to detect IPv4 gateway on %s", iface)

    # IPv4: Resolve gateway MAC via ARP
    if gateway_ip:
        try:
            ans, _ = srp(
                Ether(dst="ff:ff:ff:ff:ff:ff") / ARP(pdst=gateway_ip),
                iface=iface,
                timeout=2,
                retry=1,
                verbose=0,
            )
            gateway_mac = ans[0][1][ARP].hwsrc.lower() if ans else None
        except Exception:
            log.exception("ARP failed on %s for %s", iface, gateway_ip)

    # IPv6: Get default gateway IP for this interface
    try:
        result = subprocess.run(
            ["ip", "-6", "route", "show", "default", "dev", iface],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        lines = result.stdout.strip().split("\n")
        if lines and lines[0]:
            gateway_ip6 = lines[0].split()[2]  # "default via <ip6> dev <iface>"
    except Exception:
        log.exception("failed to detect IPv6 gateway on %s", iface)

    # IPv6: Query kernel neighbor table for MAC (secure: never hand-roll NS/NA)
    if gateway_ip6:
        try:
            result = subprocess.run(
                ["ip", "-6", "neigh", "show", gateway_ip6, "dev", iface],
                capture_output=True,
                text=True,
                timeout=5,
                check=False,
            )
            # Format: "<ip6> dev <iface> lladdr <mac> ... REACHABLE"
            line = result.stdout.strip().split("\n")[0] if result.stdout.strip() else ""
            if "lladdr" in line:
                parts = line.split()
                idx = parts.index("lladdr")
                if idx + 1 < len(parts):
                    gateway_mac6 = parts[idx + 1].lower()
        except Exception:
            log.exception("IPv6 neighbor lookup failed on %s for %s", iface, gateway_ip6)

    return LanFacts(
        gateway_ip=gateway_ip,
        gateway_mac=gateway_mac,
        box_mac=box_mac,
        gateway_ip6=gateway_ip6,
        gateway_mac6=gateway_mac6,
    )


class InterfaceManager:
    """Auto-detect and manage per-interface discovery/redirect/resist.

    Designed for when LAN_IFACE is unset. Each interface gets one redirection manager,
    and discovery is spawned in a separate thread (started only if discovery succeeds).
    """

    def __init__(
        self,
        cfg: Config,
        *,
        on_seen: Any = None,
        lan_cidrs: list[str] | None = None,
        rescanner: Rescanner | None = None,
    ) -> None:
        self.cfg = cfg
        self._rescanner = rescanner or Rescanner()
        self._on_seen = on_seen or (lambda s: None)
        self.on_new_ip: Callable[[str, str], None] = lambda mac, ip: None  # set by Service
        self._lan_cidrs = lan_cidrs or []
        self._lock = threading.Lock()
        # iface -> (stop_event, RedirectionManager, ResistanceWatch)
        self._managers: dict[
            str, tuple[threading.Event, RedirectionManager, ResistanceWatch | None]
        ] = {}
        self._global_stop = threading.Event()

    def sync(self) -> None:
        """Update managers for current set of interfaces."""
        with self._lock:
            want_ifaces = {iface for iface, _ in lan_addrs()}
            old_ifaces = set(self._managers)

            # Stop managers for gone interfaces
            for iface in old_ifaces - want_ifaces:
                stop_ev, redir, watch = self._managers.pop(iface)
                stop_ev.set()
                try:
                    redir.stop_all()
                except Exception:
                    log.exception("failed to stop redirection on %s", iface)
                if watch is not None:
                    try:
                        watch.stop()
                    except Exception:
                        log.exception("failed to stop resistance watch on %s", iface)

            # Start managers for new interfaces
            for iface in want_ifaces - old_ifaces:
                stop_ev = threading.Event()
                try:
                    cfg_iface = replace(self.cfg, lan_iface=iface)
                    # Detect gateway on this specific interface
                    lan = detect_iface_gateway(iface)
                    redir = RedirectionManager(cfg_iface, lan=lan)
                    counter = ResistanceCounter(lan, lan_cidrs=self._lan_cidrs)
                    watch = ResistanceWatch(
                        cfg_iface, counter, on_new_ip=lambda m, ip: self.on_new_ip(m, ip)
                    )
                    self._managers[iface] = (stop_ev, redir, watch)

                    # Spawn discovery for this interface in its own thread
                    threading.Thread(
                        target=self._run_discovery,
                        args=(iface, stop_ev, lan),
                        daemon=True,
                    ).start()
                    log.info(
                        "started enforcement on interface %s (gateway %s)", iface, lan.gateway_ip
                    )
                except Exception:
                    log.exception("failed to start enforcement on %s", iface)

    def _run_discovery(
        self, iface: str, stop: threading.Event, lan: LanFacts | None = None
    ) -> None:
        """Run discovery on one interface until stop is set; reports carry that network's
        gateway/box MACs so the backend hides them."""

        def enrich(seen):
            return (
                enrich_seen_with_gateway_and_box(seen, lan.gateway_mac, lan.box_mac)
                if lan
                else seen
            )

        try:
            run_discovery(
                self.cfg,
                stop,
                self._on_seen,
                iface=iface,
                enrich=enrich,
                wake=self._rescanner.register(),
            )
        except Exception:
            log.exception("discovery on %s crashed", iface)
            with self._lock:
                if iface in self._managers:
                    self._managers[iface][0].set()  # stop_ev

    def run(self, stop: threading.Event) -> None:
        """Sync interface changes every 30 seconds until stop is set."""
        self._global_stop = stop
        while not stop.is_set():
            try:
                self.sync()
            except Exception:
                log.exception("interface sync failed")
            stop.wait(30)
        # Cleanup
        with self._lock:
            for iface in list(self._managers):
                stop_ev, redir, watch = self._managers.pop(iface)
                stop_ev.set()
                try:
                    redir.stop_all()
                except Exception:
                    log.exception("final stop_all on %s failed", iface)
                if watch is not None:
                    try:
                        watch.stop()
                    except Exception:
                        log.exception("final watch.stop on %s failed", iface)

    def set_targets(self, by_iface: dict[str, dict[str, TargetAddrs]]) -> None:
        """Set enforcement targets per interface."""
        with self._lock:
            for iface, (_, redir, watch) in self._managers.items():
                devs = by_iface.get(iface, {})
                redir.set_targets(devs)
                if watch is not None:
                    watch.set_watched(devs)

    def resisting(self) -> set[str]:
        """Return set of MACs currently resisting enforcement."""
        with self._lock:
            macs: set[str] = set()
            for _, _, watch in self._managers.values():
                if watch is not None:
                    macs.update(watch.counter.resisting())
            return macs

    def infra(self) -> tuple[set[str], set[str]]:
        """Return (gateway_macs, gateway_ips) to never enforce/spoof. Includes IPv6."""
        with self._lock:
            macs, ips = set(), set()
            for _, redir, _ in self._managers.values():
                try:
                    lan = redir._lanfacts()
                    if lan.gateway_mac:
                        macs.add(lan.gateway_mac.lower())
                    if lan.gateway_ip:
                        ips.add(lan.gateway_ip)
                    if lan.gateway_mac6:
                        macs.add(lan.gateway_mac6.lower())
                    if lan.gateway_ip6:
                        ips.add(lan.gateway_ip6)
                    if lan.box_mac:
                        macs.add(lan.box_mac.lower())
                except Exception:
                    log.exception("infra check failed on interface")
            return macs, ips

    def networks(self) -> list[dict]:
        """Return detected networks: [{"iface": str, "gateway_ip": str, "auto_label": str}]."""
        with self._lock:
            nets = []
            for iface, (_, redir, _) in self._managers.items():
                try:
                    lan = redir._lanfacts()
                    if lan.gateway_ip:
                        nets.append(
                            {
                                "iface": iface,
                                "gateway_ip": lan.gateway_ip,
                                "auto_label": f"Network on {iface}",
                            }
                        )
                except Exception:
                    log.exception("network collection failed on interface")
            return nets
