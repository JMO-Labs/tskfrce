import threading
import time
from types import SimpleNamespace as NS

import pytest
from blocker import discovery
from blocker.config import Config
from blocker.discovery import resolve_hostname, run_discovery, scan_once


def _cfg(tmp_path, **kw):
    return Config(
        backend_url="http://x",
        blocker_url_host="b",
        internal_token="t",
        lan_iface="eth0",
        data_dir=tmp_path,
        **kw,
    )


def _pair(ip, mac):
    return (None, NS(ip=ip, mac=mac))


def _send(arp=(), ndp=()):
    def send(kind, cfg, iface=None):
        return ([_pair(*r) for r in (arp if kind == "arp" else ndp)], [])

    return send


@pytest.fixture
def reported(monkeypatch):
    calls = []
    monkeypatch.setattr(discovery, "report_seen", lambda cfg, s: calls.append(s))
    monkeypatch.setattr(discovery, "vendor_for", lambda mac: "V" + mac[-2:])
    return calls


def test_scan_once_builds_seen_from_arp_replies(tmp_path, reported):
    arp = [("192.168.1.5", "AA:BB:CC:00:00:01"), ("192.168.1.6", "aa:bb:cc:00:00:02")]
    out = scan_once(_cfg(tmp_path), send=_send(arp), resolve=lambda ip: "h" + ip[-1])
    assert [(s.mac, s.ip, s.hostname, s.vendor) for s in out] == [
        ("aa:bb:cc:00:00:01", "192.168.1.5", "h5", "V01"),
        ("aa:bb:cc:00:00:02", "192.168.1.6", "h6", "V02"),
    ]


def test_scan_once_reports_each(tmp_path, reported):
    arp = [("192.168.1.5", "aa:bb:cc:00:00:01"), ("192.168.1.6", "aa:bb:cc:00:00:02")]
    out = scan_once(_cfg(tmp_path), send=_send(arp), resolve=lambda ip: None)
    assert reported == out and len(reported) == 2


def test_scan_merges_ipv6_by_mac(tmp_path, reported):
    arp = [("192.168.1.5", "aa:bb:cc:00:00:01")]
    ndp = [("fe80::1", "AA:BB:CC:00:00:01"), ("fe80::2", "aa:bb:cc:00:00:01")]
    out = scan_once(_cfg(tmp_path), send=_send(arp, ndp), resolve=lambda ip: None)
    assert len(out) == 1 and out[0].ipv6 == ["fe80::1", "fe80::2"]


def test_scan_caps_lists_and_strings(tmp_path, reported):
    arp = [("192.168.1.5", "aa:bb:cc:00:00:01")]
    ndp = [(f"fe80::{i}", "aa:bb:cc:00:00:01") for i in range(1, 12)]
    out = scan_once(_cfg(tmp_path), send=_send(arp, ndp), resolve=lambda ip: "h" * 400)
    assert len(out[0].ipv6) == 8 and len(out[0].hostname) == 255


def test_scan_caps_vendor(tmp_path, reported, monkeypatch):
    monkeypatch.setattr(discovery, "vendor_for", lambda mac: "v" * 400)
    arp = [("192.168.1.5", "aa:bb:cc:00:00:01")]
    out = scan_once(_cfg(tmp_path), send=_send(arp), resolve=lambda ip: None)
    assert len(out[0].vendor) == 255


def test_resolve_hostname_never_raises(monkeypatch):
    def boom(ip):
        raise OSError("nope")

    monkeypatch.setattr(discovery.socket, "gethostbyaddr", boom)
    assert resolve_hostname("1.2.3.4") is None


def test_resolve_hostname_returns_name(monkeypatch):
    monkeypatch.setattr(discovery.socket, "gethostbyaddr", lambda ip: ("pc.lan", [], [ip]))
    assert resolve_hostname("1.2.3.4") == "pc.lan"


def test_run_discovery_calls_on_seen(tmp_path, reported, monkeypatch):
    stop = threading.Event()
    arp = [("192.168.1.5", "aa:bb:cc:00:00:01")]
    real = discovery.scan_once
    monkeypatch.setattr(
        discovery,
        "scan_once",
        lambda cfg, **k: real(cfg, send=_send(arp), resolve=lambda ip: None, **k),
    )
    got = []

    def on_seen(s):
        got.append(s)
        stop.set()

    run_discovery(_cfg(tmp_path, scan_interval=0.01), stop, on_seen=on_seen)
    assert len(got) == 1 and len(reported) == 1


@pytest.mark.integration
def test_real_scapy_send_path(tmp_path):
    cfg = _cfg(tmp_path)
    assert isinstance(scan_once(cfg), list)


def test_scan_reports_enriched_seen_so_backend_learns_gateway(tmp_path, reported):
    from dataclasses import replace

    arp = [("192.168.1.1", "aa:bb:cc:00:00:01")]
    scan_once(
        _cfg(tmp_path),
        send=_send(arp),
        resolve=lambda ip: None,
        enrich=lambda s: replace(s, gateway_mac="aa:bb:cc:00:00:01", box_mac="de:ad:be:ef:00:00"),
    )
    assert reported[0].gateway_mac == "aa:bb:cc:00:00:01"
    assert reported[0].body()["box_mac"] == "de:ad:be:ef:00:00"


def _count_sweeps(monkeypatch, on_sweep=None):
    calls = []

    def fake(cfg, **k):
        calls.append(time.monotonic())
        if on_sweep:
            on_sweep(len(calls))
        return []

    monkeypatch.setattr(discovery, "scan_once", fake)
    return calls


def _wait_for(pred, timeout=3.0):
    end = time.monotonic() + timeout
    while time.monotonic() < end and not pred():
        time.sleep(0.01)
    return pred()


def test_rescan_wakes_discovery_within_a_second(tmp_path, monkeypatch):
    calls = _count_sweeps(monkeypatch)
    stop, rescanner = threading.Event(), discovery.Rescanner()
    cfg = _cfg(tmp_path, scan_interval=60)
    t = threading.Thread(
        target=run_discovery, args=(cfg, stop), kwargs={"wake": rescanner.register()}
    )
    t.start()
    assert _wait_for(lambda: len(calls) == 1)
    rescanner.trigger()
    assert _wait_for(lambda: len(calls) == 2, 1.0)
    stop.set()
    t.join(2)
    assert not t.is_alive()


def test_rescans_during_a_sweep_coalesce_into_one_extra(tmp_path, monkeypatch):
    rescanner = discovery.Rescanner()

    def on_sweep(n):
        if n == 1:
            for _ in range(5):
                rescanner.trigger()

    calls = _count_sweeps(monkeypatch, on_sweep)
    stop = threading.Event()
    cfg = _cfg(tmp_path, scan_interval=60)
    t = threading.Thread(
        target=run_discovery, args=(cfg, stop), kwargs={"wake": rescanner.register()}
    )
    t.start()
    assert _wait_for(lambda: len(calls) == 2)
    time.sleep(0.8)
    assert len(calls) == 2
    stop.set()
    t.join(2)


def test_service_wires_rescan_into_every_make_api():
    import re
    from pathlib import Path

    src = (Path(discovery.__file__).parent / "service.py").read_text()
    calls = re.findall(r"make_api\(.*?\n\s*\)\n", src, re.DOTALL)
    assert len(calls) == 3 and all("rescan=" in c for c in calls)
