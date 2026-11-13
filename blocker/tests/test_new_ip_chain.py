"""AC3 end to end: sniffer frame -> Service -> RedirectionManager burst for the new IP."""

from __future__ import annotations

import ipaddress
import threading
from pathlib import Path
from types import SimpleNamespace

import pytest

pytest.importorskip("scapy")

import blocker.service as service_mod
from blocker.arp import LanFacts, RedirectionManager
from blocker.backend import Seen
from blocker.config import Config
from blocker.resist import ResistanceCounter, ResistanceWatch
from blocker.service import Service

CFG = Config(
    backend_url="http://b",
    blocker_url_host="b",
    internal_token="t",
    lan_iface="eth0",
    data_dir=Path("/tmp"),
)
LAN = LanFacts(
    gateway_ip="192.168.1.1", gateway_mac="aa:aa:aa:aa:aa:aa", box_mac="bb:bb:bb:bb:bb:bb"
)
MAC = "de:ad:be:ef:00:01"


class FakeSend:
    def __init__(self) -> None:
        self.calls: list[list] = []
        self.event = threading.Event()

    def __call__(self, pkts, iface) -> None:
        self.calls.append(pkts)
        self.event.set()


class FakeFirewall:
    def apply(self, ruleset: str) -> None:
        pass

    def flush(self) -> None:
        pass

    def enable_forwarding(self) -> None:
        pass


def test_sniffed_new_ip_is_spoofed_before_the_cadence_tick(monkeypatch):
    from scapy.layers.l2 import ARP, Ether

    nets = [("eth0", ipaddress.ip_network("192.168.1.0/24"))]
    monkeypatch.setattr(service_mod, "lan_networks", lambda: nets)
    fs = FakeSend()
    redir = RedirectionManager(CFG, lan=LAN, send=fs, cadence=30)  # next tick far away
    svc = Service(CFG, firewall=FakeFirewall(), redirection=redir, sleep=lambda *_: None)
    cap: dict = {}
    svc._watch = ResistanceWatch(
        CFG,
        ResistanceCounter(LAN),
        sniffer_factory=lambda **kw: cap.update(kw) or SimpleNamespace(stop=lambda: None),
        on_new_ip=svc._on_new_ip,
    )
    try:
        svc._on_seen(Seen(mac=MAC, ip="192.168.1.50", ipv6=[], hostname=None, vendor=None))
        svc.store.set_blocked([MAC])
        assert fs.event.wait(1.0)  # the loop's first round
        n = len(fs.calls)
        frame = Ether(src=MAC, dst="ff:ff:ff:ff:ff:ff") / ARP(op=1, hwsrc=MAC, psrc="192.168.1.77")
        cap["prn"](frame)
        new = [p for call in fs.calls[n:] for p in call if p.haslayer(ARP)]
        assert any(p[ARP].pdst == "192.168.1.77" for p in new)
    finally:
        redir.stop_all()
