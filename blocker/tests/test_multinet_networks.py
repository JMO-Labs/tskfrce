import ipaddress
import threading
from types import SimpleNamespace

from blocker import multinet
from blocker.multinet import InterfaceManager


def test_networks_reports_ipv4_cidr(monkeypatch):
    mgr = InterfaceManager.__new__(InterfaceManager)
    mgr._lock = threading.RLock()
    redir = SimpleNamespace(_lanfacts=lambda: SimpleNamespace(gateway_ip="192.168.1.1"))
    mgr._managers = {"eno2": (None, redir, None), "wlo1": (None, redir, None)}
    monkeypatch.setattr(
        multinet,
        "lan_networks",
        lambda: [
            ("eno2", ipaddress.ip_network("192.168.1.0/24")),
            ("wlo1", ipaddress.ip_network("10.10.40.0/24")),
        ],
    )
    got = {n["iface"]: n["subnet"] for n in mgr.networks()}
    assert got == {"eno2": "192.168.1.0/24", "wlo1": "10.10.40.0/24"}


def test_sync_wires_on_dot_into_watch(monkeypatch):
    seen = {}

    class FakeWatch:
        def __init__(self, cfg, counter, **kw):
            seen.update(kw)

    class FakeRedir:
        def __init__(self, *a, **k):
            self.poke = self.answer = None

    monkeypatch.setattr(multinet, "lan_addrs", lambda: [("eno2", None)])
    monkeypatch.setattr(multinet, "detect_iface_gateway", lambda i: SimpleNamespace(gateway_ip="x"))
    monkeypatch.setattr(multinet, "RedirectionManager", FakeRedir)
    monkeypatch.setattr(multinet, "ResistanceCounter", lambda *a, **k: None)
    monkeypatch.setattr(multinet, "ResistanceWatch", FakeWatch)
    monkeypatch.setattr(multinet.threading, "Thread", lambda **k: SimpleNamespace(start=lambda: None))
    got = []
    mgr = InterfaceManager(SimpleNamespace(lan_iface=""))
    mgr.on_dot = got.append
    mgr.sync()
    seen["on_dot"]("aa:bb")
    assert got == ["aa:bb"]
