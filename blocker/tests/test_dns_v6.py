"""The IPv6 DNS listener runs once per service, not once per LAN address."""

from __future__ import annotations

import socket
import threading
from unittest.mock import patch

import pytest

from blocker import dns_v6


def test_retries_bind_until_it_succeeds():
    calls = []

    def fake(cfg, box, stop, bind, **kw):
        calls.append(bind)
        if len(calls) < 3:
            raise OSError("in use")

    dns_v6.serve(None, lambda: "10.0.0.2", threading.Event(), {}, run=fake, retry=0.01)
    assert calls == [("::", 53)] * 3


def test_stops_retrying_when_stop_set():
    stop = threading.Event()
    n = []

    def fake(cfg, box, stop_, bind, **kw):
        n.append(1)
        stop.set()
        raise OSError("no v6")

    dns_v6.serve(None, lambda: "10.0.0.2", stop, {}, run=fake, retry=0.01)
    assert len(n) == 1


def test_waits_for_a_box_ip_never_runs_with_empty():
    boxes = iter(["", "", "192.168.7.2"])
    got = []

    def fake(cfg, box, stop, bind, **kw):
        got.append(box)

    dns_v6.serve(None, lambda: next(boxes), threading.Event(), {}, run=fake, retry=0.01)
    assert got == ["192.168.7.2"]


def test_service_one_v6_listener_independent_of_per_address_stops():
    from blocker.tests.test_service import _svc

    svc, _fw, _redir = _svc()
    svc._portal_ip = "10.0.0.2"
    binds: list[tuple] = []
    v6_stops: list[threading.Event] = []
    started = threading.Semaphore(0)

    def fake_run_dns(cfg, box, stop, bind=("0.0.0.0", 53), **kw):
        binds.append(bind)
        if bind[0] == "::":
            v6_stops.append(stop)
        started.release()
        stop.wait(10)

    with (
        patch("blocker.service.run_dns", fake_run_dns),
        patch("blocker.dns_v6.run_dns", fake_run_dns),
        patch("blocker.service.run_http", lambda *a, **k: None),
    ):
        svc._start_dns_v6()
        per_addr = [threading.Event() for _ in range(3)]
        ended = threading.Event()

        def serve0():
            svc._serve_portal("192.168.0.2", per_addr[0])
            ended.set()

        threading.Thread(target=serve0, daemon=True).start()
        for i in (1, 2):
            threading.Thread(
                target=svc._serve_portal, args=(f"192.168.{i}.2", per_addr[i]), daemon=True
            ).start()
        for _ in range(4):
            assert started.acquire(timeout=5)
        assert [b for b in binds if b[0] == "::"] == [("::", 53)]
        assert len([b for b in binds if b[0] != "::"]) == 3
        per_addr[0].set()
        assert ended.wait(5)
        assert not v6_stops[0].is_set()
        assert v6_stops[0] is svc._stop
        svc._stop.set()
        for ev in per_addr:
            ev.set()


def _v6_loopback_port() -> int | None:
    try:
        s = socket.socket(socket.AF_INET6, socket.SOCK_DGRAM)
        s.bind(("::1", 0))
    except OSError:
        return None
    port = s.getsockname()[1]
    s.close()
    return port


def test_v6_listener_without_portal_ip_answers_portal_a_query():
    """Multi-network mode (no portal_ip): the reply still carries a LAN v4 A record."""
    from blocker.scapy_lite import DNS, DNSQR
    from blocker.tests.test_service import _svc

    port = _v6_loopback_port()
    if port is None:
        pytest.skip("no IPv6 loopback")
    svc, _fw, _redir = _svc()
    svc._portal_ip = None
    with (
        patch("blocker.service.lan_addrs", lambda: [("br-lan", "192.168.9.2")]),
        patch("blocker.portal.real_ip", lambda *a, **k: None),
        patch.object(svc, "_dns_kw", lambda: {}),
    ):
        svc._start_dns_v6(bind=("::1", port))
        c = socket.socket(socket.AF_INET6, socket.SOCK_DGRAM)
        c.settimeout(0.5)
        q = bytes(DNS(id=9, rd=1, qd=DNSQR(qname="example.com.", qtype=1)))
        reply = None
        try:
            for _ in range(20):
                c.sendto(q, ("::1", port))
                try:
                    reply = c.recv(512)
                    break
                except TimeoutError:
                    continue
        finally:
            svc._stop.set()
            c.close()
    assert reply is not None
    assert DNS(reply).an.rdata == "192.168.9.2"
