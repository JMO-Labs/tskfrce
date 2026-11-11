"""Multi-interface support when LAN_IFACE is unset (spec A2).

Tracks and manages discovery/redirection/resistance per auto-detected interface.
Similar to SiteManager but for base interfaces instead of VLANs.
"""

from __future__ import annotations

import ipaddress
import logging
import threading
from dataclasses import replace
from typing import Any

from blocker.arp import RedirectionManager, TargetAddrs
from blocker.backend import Seen
from blocker.config import Config
from blocker.discovery import run_discovery
from blocker.ifaces import lan_addrs
from blocker.resist import ResistanceCounter, ResistanceWatch

log = logging.getLogger(__name__)


class InterfaceManager:
    """Auto-detect and manage per-interface discovery/redirect/resist.

    Designed for when LAN_IFACE is unset. Each (iface, ip) pair gets one redirection manager.
    """

    def __init__(
        self,
        cfg: Config,
        *,
        on_seen: Any = None,
        lan_cidrs: list[str] | None = None,
    ) -> None:
        self.cfg = cfg
        self._on_seen = on_seen or (lambda s: None)
        self._lan_cidrs = lan_cidrs or []
        self._lock = threading.Lock()
        # iface -> {RedirectionManager, ResistanceWatch}
        self._managers: dict[str, tuple[RedirectionManager, ResistanceWatch | None]] = {}
        self._stop = threading.Event()

    def sync(self) -> None:
        """Update managers for current set of interfaces."""
        with self._lock:
            want_ifaces = {iface for iface, _ in lan_addrs()}
            old_ifaces = set(self._managers)

            # Stop managers for gone interfaces
            for iface in old_ifaces - want_ifaces:
                redir, watch = self._managers.pop(iface)
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
                try:
                    cfg_iface = replace(self.cfg, lan_iface=iface)
                    redir = RedirectionManager(cfg_iface)
                    counter = ResistanceCounter(redir._lanfacts(), lan_cidrs=self._lan_cidrs)
                    watch = ResistanceWatch(cfg_iface, counter)
                    # Spawn discovery for this interface
                    threading.Thread(
                        target=lambda i=iface, s=self._stop: run_discovery(
                            self.cfg, s, self._on_seen, iface=i
                        ),
                        daemon=True,
                    ).start()
                    self._managers[iface] = (redir, watch)
                    log.info("started enforcement on interface %s", iface)
                except Exception:
                    log.exception("failed to start enforcement on %s", iface)

    def run(self, stop: threading.Event) -> None:
        """Sync interface changes every 30 seconds until stop is set."""
        self._stop = stop
        while not stop.is_set():
            try:
                self.sync()
            except Exception:
                log.exception("interface sync failed")
            stop.wait(30)
        # Cleanup
        with self._lock:
            for iface in list(self._managers):
                redir, watch = self._managers.pop(iface)
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
            for iface, (redir, watch) in self._managers.items():
                devs = by_iface.get(iface, {})
                redir.set_targets(devs)
                if watch is not None:
                    watch.set_watched(devs)

    def resisting(self) -> set[str]:
        """Return set of MACs currently resisting enforcement."""
        with self._lock:
            macs: set[str] = set()
            for _, (_, watch) in self._managers.items():
                if watch is not None:
                    macs.update(watch.counter.resisting())
            return macs

    def infra(self) -> tuple[set[str], set[str]]:
        """Return (gateway_macs, gateway_ips) to never enforce/spoof."""
        with self._lock:
            macs, ips = set(), set()
            for _, (redir, _) in self._managers.items():
                try:
                    lan = redir._lanfacts()
                    if lan.gateway_mac:
                        macs.add(lan.gateway_mac.lower())
                    if lan.gateway_ip:
                        ips.add(lan.gateway_ip)
                    if lan.box_mac:
                        macs.add(lan.box_mac.lower())
                except Exception:
                    log.exception("infra check failed on interface")
            return macs, ips
