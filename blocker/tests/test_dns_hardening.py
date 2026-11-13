"""Paused-device DNS: type filter, per-client name cap, bounded non-blocking lookups, LRU cache."""

import socket
import threading
import time

import pytest

from blocker import portal, sni_gate

pytest.importorskip("scapy")
from scapy.layers.dns import DNS, DNSQR  # noqa: E402


def _q(name="example.com.", qtype="A"):
    return bytes(DNS(id=7, rd=1, qd=DNSQR(qname=name, qtype=qtype)))


@pytest.fixture(autouse=True)
def _fresh(monkeypatch):
    sni_gate._CACHE.clear()
    sni_gate._names.clear()
    yield
    sni_gate._CACHE.clear()
    sni_gate._names.clear()


def _fake_resolver(monkeypatch, fn):
    monkeypatch.setattr(socket, "getaddrinfo", lambda n, *a, **k: [(0, 0, 0, "", (fn(n), 443))])


@pytest.mark.parametrize("qtype", ["TXT", "NULL", "MX", "SRV", "CNAME", "ANY", "AAAA", 65])
def test_non_a_types_get_nodata_without_lookup(monkeypatch, qtype):
    calls = []
    _fake_resolver(monkeypatch, lambda n: calls.append(n) or "1.2.3.4")
    out = DNS(portal.handle_query(_q(qtype=qtype), ("10.0.0.5", 5000), "10.0.0.2"))
    assert calls == []
    assert out.rcode == 0 and out.ancount == 0


def test_a_query_still_resolves_upstream(monkeypatch):
    _fake_resolver(monkeypatch, lambda n: "1.2.3.4")
    out = DNS(portal.handle_query(_q(), ("10.0.0.5", 5000), "10.0.0.2"))
    assert out.an.rdata == "1.2.3.4"


def test_per_client_cap_answers_box_ip_without_lookup(monkeypatch):
    calls = []
    _fake_resolver(monkeypatch, lambda n: calls.append(n) or "1.2.3.4")
    for i in range(sni_gate.NAMES_PER_MIN + 5):
        out = DNS(portal.handle_query(_q(f"n{i}.example."), ("10.0.0.5", 5000), "10.0.0.2"))
    assert len(calls) == sni_gate.NAMES_PER_MIN
    assert out.an.rdata == "10.0.0.2"
    # another client is unaffected
    out = DNS(portal.handle_query(_q("other.example."), ("10.0.0.6", 5000), "10.0.0.2"))
    assert out.an.rdata == "1.2.3.4"


def test_cache_is_bounded(monkeypatch):
    _fake_resolver(monkeypatch, lambda n: "1.2.3.4")
    for i in range(1000):
        sni_gate.real_ip(f"r{i}.example", client=f"c{i % 50}")
    assert len(sni_gate._CACHE) <= sni_gate.CACHE_MAX


def test_expired_entries_evicted(monkeypatch):
    _fake_resolver(monkeypatch, lambda n: "1.2.3.4")
    sni_gate.real_ip("old.example", ttl=0.01)
    time.sleep(0.03)
    sni_gate.real_ip("new.example", ttl=0.01)
    assert "old.example" not in sni_gate._CACHE


def test_slow_resolver_times_out(monkeypatch):
    monkeypatch.setattr(sni_gate, "LOOKUP_TIMEOUT", 0.2)
    _fake_resolver(monkeypatch, lambda n: time.sleep(1) or "1.2.3.4")
    t0 = time.monotonic()
    assert sni_gate.real_ip("slow.example", client="a") is None
    assert time.monotonic() - t0 < 0.8


def test_slow_resolver_does_not_delay_other_client(monkeypatch):
    release = threading.Event()

    def resolve(n):
        if n.startswith("slow"):
            release.wait(3)
        return "1.2.3.4"

    _fake_resolver(monkeypatch, resolve)
    stop = threading.Event()
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    t = threading.Thread(
        target=portal.run_dns, args=(None, "10.0.0.2", stop), kwargs={"bind": ("127.0.0.1", port)}
    )
    t.start()
    time.sleep(0.2)
    try:
        slow = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        slow.sendto(_q("slow.example."), ("127.0.0.1", port))
        fast = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        fast.settimeout(1.0)
        t0 = time.monotonic()
        fast.sendto(_q("fast.example."), ("127.0.0.1", port))
        data, _ = fast.recvfrom(512)
        assert time.monotonic() - t0 < 1.0
        assert DNS(data).an.rdata == "1.2.3.4"
    finally:
        release.set()
        stop.set()
        t.join(3)
