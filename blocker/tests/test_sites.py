"""SiteManager with a fake command runner (no root, no network)."""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from blocker.arp import TargetAddrs
from blocker.config import Config
from blocker.sites import SiteManager, SiteParts

CFG = Config("http://b", "b", "t", "eth0", Path("/tmp"))


class FakeHost:
    """Simulates just the `ip`/busybox calls the manager makes."""

    def __init__(self, links=(), dhcp=True):
        self.links = set(links)
        self.addrs: dict[str, str] = {}
        self.routers: dict[str, str] = {}
        self.dhcp = dhcp
        self.calls: list[list[str]] = []

    def __call__(self, a: list[str]) -> tuple[int, str]:
        self.calls.append(a)
        if a[:4] == ["ip", "-o", "link", "show"]:
            return (0 if a[-1] in self.links else 1), ""
        if a[:3] == ["ip", "link", "add"]:
            self.links.add(a[5])
            return 0, ""
        if a[:3] == ["ip", "link", "del"]:
            self.links.discard(a[3])
            return 0, ""
        if a[:2] == ["busybox", "udhcpc"]:
            if self.dhcp:
                self.addrs[a[3]] = "192.168.20.7"
                self.routers[a[3]] = "192.168.20.1"
            return 0, ""
        if a[:4] == ["ip", "-4", "-o", "addr"]:
            ip = self.addrs.get(a[-1])
            return 0, (f"3: {a[-1]} inet {ip}/24 brd x\n" if ip else "")
        if a[:2] == ["busybox", "cat"]:
            if a[2].endswith(".router"):
                r = self.routers.get(a[2].split("/")[-1][:-7])
                return (0, r + "\n") if r else (1, "")
            return 0, "4242\n"
        return 0, ""

    def ran(self, *prefix) -> list[list[str]]:
        return [c for c in self.calls if c[: len(prefix)] == list(prefix)]


def _mgr(host, parts=None):
    made = []

    def factory(cfg, router, vid, stop, on_seen, cidrs):
        p = SiteParts(Mock(), Mock())
        p.watch.counter.resisting.return_value = set()
        made.append((cfg, router, vid, p))
        return p

    m = SiteManager(CFG, run=host, parts_factory=factory, sleep=lambda s: None, dhcp_timeout=2)
    return m, made


def test_creates_interface_runs_dhcp_and_enforces():
    h = FakeHost()
    m, made = _mgr(h)
    m.sync({20})
    assert h.ran("ip", "link", "add", "link", "eth0", "name", "eth0.20", "type", "vlan", "id", "20")
    assert h.ran("ip", "link", "set", "eth0.20", "up")
    (udhcpc,) = h.ran("busybox", "udhcpc")
    assert udhcpc[:5] == ["busybox", "udhcpc", "-i", "eth0.20", "-s"] and "-b" in udhcpc
    cfg, router, vid, _ = made[0]
    assert (cfg.lan_iface, router, vid) == ("eth0.20", "192.168.20.1", 20)


def test_reuses_existing_and_never_deletes_foreign():
    h = FakeHost(links={"br0.20"})
    h.addrs["br0.20"], h.routers["br0.20"] = "192.168.20.9", "192.168.20.1"
    m, made = _mgr(h)
    m.sync({20})
    assert not h.ran("ip", "link", "add") and not h.ran("busybox", "udhcpc")
    assert made[0][0].lan_iface == "br0.20"
    m.sync(set())
    assert not h.ran("ip", "link", "del") and "br0.20" in h.links
    made[0][3].redir.stop_all.assert_called_once()


def test_remove_restores_and_deletes_created_only():
    h = FakeHost()
    m, made = _mgr(h)
    m.sync({20})
    m.sync(set())
    p = made[0][3]
    p.redir.stop_all.assert_called_once()
    p.watch.stop.assert_called_once()
    assert h.ran("busybox", "kill", "4242")
    assert h.ran("ip", "link", "del", "eth0.20") and "eth0.20" not in h.links
    assert m.sites == {}


def test_dhcp_failure_is_passive_and_retried():
    h = FakeHost(dhcp=False)
    m, made = _mgr(h)
    m.sync({20})
    assert made == [] and m.sites[20].parts is None
    m.set_targets({20: {"m": TargetAddrs(mac="m", ip="1.2.3.4")}})  # no-op, no crash
    h.dhcp = True
    h.addrs["eth0.20"], h.routers["eth0.20"] = "192.168.20.7", "192.168.20.1"
    m.sync({20})  # late lease promotes the passive site
    assert len(made) == 1


def test_set_targets_routes_by_vid_and_stop_all():
    h = FakeHost()
    m, made = _mgr(h)
    m.sync({20, 30})
    t = {"m": TargetAddrs(mac="m", ip="192.168.20.5")}
    m.set_targets({20: t})
    parts = {vid: p for _, _, vid, p in made}
    parts[20].redir.set_targets.assert_called_with(t)
    parts[30].redir.set_targets.assert_called_with({})
    m.stop_all()
    assert all(p.redir.stop_all.called for p in parts.values())


def test_no_lan_iface_is_noop():
    h = FakeHost()
    SiteManager(Config("http://b", "b", "t", "", Path("/tmp")), run=h).sync({20})
    assert h.calls == []


def test_infra_reports_site_gateway():
    h = FakeHost()
    m, made = _mgr(h)
    m.sync({20})
    made[0][3].redir._lanfacts.return_value = SimpleNamespace(
        gateway_mac="AA:00", box_mac="bb:00", gateway_ip="192.168.20.1"
    )
    assert m.infra() == ({"aa:00", "bb:00"}, {"192.168.20.1"})


@pytest.mark.integration
def test_real_run_executes_and_survives_missing_binary():
    from blocker.sites import real_run

    assert real_run(["echo", "hi"]) == (0, "hi\n")
    assert real_run(["definitely-not-a-binary"])[0] == 127


def test_passive_retry_does_not_wait():
    h = FakeHost(dhcp=False)
    naps = []
    m = SiteManager(CFG, run=h, parts_factory=lambda *a: None, sleep=naps.append, dhcp_timeout=2)
    m.sync({20})
    first = len(naps)
    m.sync({20})  # still no lease: look once, don't sleep under the lock
    assert first > 0 and len(naps) == first
