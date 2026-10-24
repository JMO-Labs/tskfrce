"""Per-VLAN "sites": one interface plus its own discovery, redirection and resistance.

The base (untagged) LAN is the default site and stays in ``Service``; this module
manages the additional, covered tagged VLANs. A site's classes are the existing
ones, handed a config whose ``lan_iface`` is the site interface. A site that gets
no address+router from DHCP is passive (the VLAN detector still sees its devices)
and never enforces. Interfaces we did not create are never deleted. Every kernel
and process call goes through an injectable ``run`` so tests need no root.
"""

from __future__ import annotations

import logging
import re
import subprocess
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, replace
from typing import Any

from blocker.arp import LanFacts, RedirectionManager, TargetAddrs
from blocker.backend import Seen
from blocker.config import Config
from blocker.discovery import run_discovery
from blocker.resist import ResistanceCounter, ResistanceWatch

log = logging.getLogger(__name__)

UDHCPC_SCRIPT = "/app/udhcpc.sh"
RUN_DIR = "/run/blocker"
DHCP_TIMEOUT = 15.0
DHCP_POLL = 1.0

Run = Callable[[list[str]], tuple[int, str]]
_INET = re.compile(r"\binet (\d+\.\d+\.\d+\.\d+)/")
_DEFAULT = re.compile(r"^default via (\S+)", re.M)


def real_run(args: list[str]) -> tuple[int, str]:
    try:
        p = subprocess.run(args, capture_output=True, text=True, timeout=10, check=False)
        return p.returncode, p.stdout
    except (OSError, subprocess.SubprocessError) as e:
        log.warning("command %s failed: %s", args[0], e)
        return 127, ""


@dataclass
class SiteParts:
    """What a live site runs; the real ones are built by ``build_parts``."""

    redir: Any
    watch: Any


def detect_site_lan(iface: str, router: str) -> LanFacts:  # pragma: no cover - needs a LAN
    """Box MAC and the router's real MAC resolved on ``iface`` (v4 only)."""
    from scapy.all import ARP, Ether, get_if_hwaddr, srp

    ans, _ = srp(
        Ether(dst="ff:ff:ff:ff:ff:ff") / ARP(pdst=router),
        iface=iface,
        timeout=2,
        retry=1,
        verbose=0,
    )
    gw_mac = ans[0][1][ARP].hwsrc.lower() if ans else None
    return LanFacts(gateway_ip=router, gateway_mac=gw_mac, box_mac=get_if_hwaddr(iface))


def build_parts(  # pragma: no cover - real I/O
    cfg: Config,
    router: str,
    vid: int,
    stop: threading.Event,
    on_seen: Callable[[Seen], None],
    lan_cidrs: list[str],
) -> SiteParts:
    redir = RedirectionManager(cfg, detect=lambda c: detect_site_lan(c.lan_iface, router))
    watch = ResistanceWatch(cfg, ResistanceCounter(redir._lanfacts(), lan_cidrs=lan_cidrs))
    threading.Thread(target=lambda: run_discovery(cfg, stop, on_seen, vid), daemon=True).start()
    return SiteParts(redir, watch)


class Site:
    def __init__(self, vid: int, iface: str, created: bool) -> None:
        self.vid = vid
        self.iface = iface
        self.created = created  # we ran `ip link add`: we may delete it
        self.dhcp_started = False
        self.parts: SiteParts | None = None  # None = passive
        self.stop = threading.Event()

    @property
    def pidfile(self) -> str:
        return f"{RUN_DIR}/udhcpc-{self.iface}.pid"


class SiteManager:
    def __init__(
        self,
        cfg: Config,
        *,
        on_seen: Callable[[Seen], None] = lambda s: None,
        lan_cidrs: list[str] | None = None,
        run: Run = real_run,
        parts_factory: Callable[..., SiteParts] = build_parts,
        sleep: Callable[[float], None] = time.sleep,
        dhcp_timeout: float = DHCP_TIMEOUT,
    ) -> None:
        self.cfg = cfg
        self._on_seen = on_seen
        self._lan_cidrs = lan_cidrs or []
        self._run = run
        self._factory = parts_factory
        self._sleep = sleep
        self._timeout = dhcp_timeout
        self._lock = threading.Lock()
        self.sites: dict[int, Site] = {}

    # --- interface plumbing -------------------------------------------------

    def _exists(self, name: str) -> bool:
        return self._run(["ip", "-o", "link", "show", "dev", name])[0] == 0

    def _ensure_iface(self, vid: int) -> tuple[str, bool] | None:
        lan = self.cfg.lan_iface
        for name in (f"{lan}.{vid}", f"br0.{vid}"):
            if self._exists(name):
                return name, False
        name = f"{lan}.{vid}"
        rc, _ = self._run(
            ["ip", "link", "add", "link", lan, "name", name, "type", "vlan", "id", str(vid)]
        )
        if rc != 0:
            log.error("could not create VLAN interface %s", name)
            return None
        return name, True

    def _address(self, iface: str) -> str | None:
        m = _INET.search(self._run(["ip", "-4", "-o", "addr", "show", "dev", iface])[1])
        return m.group(1) if m else None

    def _router(self, iface: str) -> str | None:
        rc, out = self._run(["busybox", "cat", f"{RUN_DIR}/{iface}.router"])
        if rc == 0 and out.strip():
            return out.strip()
        m = _DEFAULT.search(self._run(["ip", "-4", "route", "show", "default", "dev", iface])[1])
        return m.group(1) if m else None

    def _lease(self, iface: str) -> tuple[str, str] | None:
        ip, gw = self._address(iface), self._router(iface)
        return (ip, gw) if ip and gw else None

    def _wait_lease(self, iface: str) -> tuple[str, str] | None:
        waited = 0.0
        while True:
            lease = self._lease(iface)
            if lease or waited >= self._timeout:
                return lease
            self._sleep(DHCP_POLL)
            waited += DHCP_POLL

    # --- lifecycle ----------------------------------------------------------

    def _create(self, vid: int) -> Site | None:
        found = self._ensure_iface(vid)
        if found is None:
            return None
        site = Site(vid, *found)
        self._run(["ip", "link", "set", site.iface, "up"])
        if not self._address(site.iface):
            self._run(["busybox", "udhcpc", "-i", site.iface, "-s", UDHCPC_SCRIPT]
                      + ["-b", "-p", site.pidfile])  # fmt: skip
            site.dhcp_started = True
        return site

    def _activate(self, site: Site, wait: bool = True) -> None:
        # Only a new site waits; retries just look, since udhcpc keeps trying in the background
        # and sync holds the lock enforcement needs.
        waiting = wait and site.dhcp_started
        lease = self._wait_lease(site.iface) if waiting else self._lease(site.iface)
        if lease is None:
            log.warning("VLAN %s (%s): no DHCP address+router; passive only", site.vid, site.iface)
            return
        try:
            site.parts = self._factory(
                replace(self.cfg, lan_iface=site.iface),
                lease[1],
                site.vid,
                site.stop,
                self._on_seen,
                self._lan_cidrs,
            )
            log.info("VLAN %s (%s): enforcing via %s", site.vid, site.iface, lease[1])
        except Exception:
            log.exception("VLAN %s: site start failed; passive only", site.vid)

    def _teardown(self, site: Site) -> None:
        site.stop.set()
        if site.parts is not None:  # restore targets first (fail open)
            for stopper in (site.parts.redir.stop_all, site.parts.watch.stop):
                try:
                    stopper()
                except Exception:
                    log.exception("VLAN %s teardown step failed", site.vid)
            site.parts = None
        if site.dhcp_started:
            rc, pid = self._run(["busybox", "cat", site.pidfile])
            if rc == 0 and pid.strip().isdigit():
                self._run(["busybox", "kill", pid.strip()])
        if site.created:
            self._run(["ip", "link", "del", site.iface])

    def sync(self, covered: set[int]) -> None:
        if not self.cfg.lan_iface:
            return
        with self._lock:
            for vid in sorted(set(self.sites) - covered):
                self._teardown(self.sites.pop(vid))
            for vid in sorted(covered):
                site = self.sites.get(vid)
                if site is None:
                    site = self._create(vid)
                    if site is None:
                        continue
                    self.sites[vid] = site
                    self._activate(site)
                elif site.parts is None:  # passive: DHCP may have answered late
                    self._activate(site, wait=False)

    def stop_all(self) -> None:
        with self._lock:
            for vid in list(self.sites):
                self._teardown(self.sites.pop(vid))

    # --- enforcement --------------------------------------------------------

    def set_targets(self, by_vid: dict[int, dict[str, TargetAddrs]]) -> None:
        """Targets per vid. Passive or absent sites enforce nothing."""
        with self._lock:
            for vid, site in self.sites.items():
                if site.parts is None:
                    continue
                devs = by_vid.get(vid, {})
                site.parts.redir.set_targets(devs)
                site.parts.watch.set_watched(devs)

    def resisting(self) -> set[str]:
        with self._lock:
            return {
                m
                for s in self.sites.values()
                if s.parts is not None
                for m in s.parts.watch.counter.resisting()
            }

    def infra(self) -> tuple[set[str], set[str]]:
        """(MACs, IPs) of site gateways and the box: never enforce or spoof these."""
        macs: set[str] = set()
        ips: set[str] = set()
        with self._lock:
            for s in self.sites.values():
                if s.parts is None:
                    continue
                try:
                    lan = s.parts.redir._lanfacts()
                except Exception:
                    continue
                macs.update(m.lower() for m in (lan.gateway_mac, lan.box_mac) if m)
                ips.add(lan.gateway_ip)
        return macs, ips
