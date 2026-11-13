"""run_dns homework dispatch: bounded pool, per-client cap, portal never waits on upstream."""

from __future__ import annotations

import socket
import threading
import time

from blocker.portal import HW_PER_CLIENT, run_dns
from scapy.layers.dns import DNS, DNSQR


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _q(txid: int) -> bytes:
    return bytes(DNS(id=txid, qr=0, rd=1, qd=[DNSQR(qname="x.com.", qtype=1)]))


def test_homework_lookups_capped_per_client():
    port = _free_port()
    stop = threading.Event()
    release = threading.Event()
    calls = []

    def handle(ip, data):
        calls.append(data)
        release.wait(5)  # upstream hangs

    t = threading.Thread(
        target=run_dns,
        args=(None, "10.0.0.2", stop),
        kwargs={"handle": handle, "claims": lambda ip: True, "bind": ("127.0.0.1", port)},
        daemon=True,
    )
    t.start()
    time.sleep(0.2)
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as c:
        for i in range(HW_PER_CLIENT + 3):
            c.sendto(_q(i), ("127.0.0.1", port))
        time.sleep(0.5)
        assert len(calls) == HW_PER_CLIENT  # excess dropped, not queued
        release.set()
        c.settimeout(2)
        replies = [DNS(c.recv(512)) for _ in range(HW_PER_CLIENT)]  # workers reply themselves
    stop.set()
    t.join(2)
    assert all(str(r.an[0].rdata) == "10.0.0.2" for r in replies)


def test_unclaimed_client_never_waits_on_upstream():
    port = _free_port()
    stop = threading.Event()
    handle_called = []

    def handle(ip, data):
        handle_called.append(1)
        time.sleep(5)

    t = threading.Thread(
        target=run_dns,
        args=(None, "10.0.0.2", stop),
        kwargs={"handle": handle, "claims": lambda ip: False, "bind": ("127.0.0.1", port)},
        daemon=True,
    )
    t.start()
    time.sleep(0.2)
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as c:
        c.settimeout(1)
        c.sendto(_q(7), ("127.0.0.1", port))
        reply = DNS(c.recv(512))
    stop.set()
    t.join(2)
    assert reply.id == 7 and str(reply.an[0].rdata) == "10.0.0.2"
    assert handle_called == []


def test_per_client_cap_keyed_by_mac_across_ips():
    """A device hopping source IPs (same MAC) shares one in-flight budget."""
    port = _free_port()
    stop = threading.Event()
    release = threading.Event()
    calls = []

    def handle(ip, data):
        calls.append(ip)
        release.wait(5)

    t = threading.Thread(
        target=run_dns,
        args=(None, "10.0.0.2", stop),
        kwargs={
            "handle": handle,
            "claims": lambda ip: True,
            "client_key": lambda ip: "aa:bb:cc:dd:ee:ff",
            "bind": ("127.0.0.1", port),
        },
        daemon=True,
    )
    t.start()
    time.sleep(0.2)
    socks = []
    for src in ("127.0.0.2", "127.0.0.3"):
        c = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        c.bind((src, 0))
        socks.append(c)
        for i in range(HW_PER_CLIENT):
            c.sendto(_q(i), ("127.0.0.1", port))
    time.sleep(0.5)
    assert len(calls) == HW_PER_CLIENT  # one budget for the MAC, not one per IP
    release.set()
    stop.set()
    t.join(2)
    for c in socks:
        c.close()


def _serve(port, stop, **kw):
    t = threading.Thread(
        target=run_dns, args=(None, "10.0.0.2", stop), kwargs={"bind": ("127.0.0.1", port), **kw}
    )
    t.daemon = True
    t.start()
    time.sleep(0.2)
    return t


def test_on_query_sees_portal_answers_for_claimed_and_unclaimed_clients():
    """Bypass alerts: a homework refusal (handle -> None) and a plain portal answer both report."""
    seen = []
    for claimed in (True, False):
        port, stop = _free_port(), threading.Event()
        t = _serve(
            port,
            stop,
            handle=lambda ip, data: None,  # homework gate refuses the name
            claims=lambda ip, c=claimed: c,
            on_query=lambda ip, name, c=claimed: seen.append((c, name)),
        )
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as c:
            c.settimeout(2)
            c.sendto(_q(1), ("127.0.0.1", port))
            assert str(DNS(c.recv(512)).an[0].rdata) == "10.0.0.2"
        stop.set()
        t.join(2)
    assert seen == [(True, "x.com."), (False, "x.com.")]


def test_on_query_not_called_for_forwarded_homework_answers():
    """An allowed homework name is answered upstream; it is not a workaround try."""
    seen = []
    port, stop = _free_port(), threading.Event()
    upstream = bytes(DNS(id=1, qr=1, qd=[DNSQR(qname="x.com.", qtype=1)]))
    t = _serve(
        port,
        stop,
        handle=lambda ip, data: upstream,
        claims=lambda ip: True,
        on_query=lambda ip, name: seen.append(name),
    )
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as c:
        c.settimeout(2)
        c.sendto(_q(1), ("127.0.0.1", port))
        assert c.recv(512) == upstream
    stop.set()
    t.join(2)
    assert seen == []


def test_run_dns_serves_over_ipv6():
    import pytest

    try:
        with socket.socket(socket.AF_INET6, socket.SOCK_DGRAM) as s:
            s.bind(("::1", 0))
            port = s.getsockname()[1]
    except OSError:
        pytest.skip("no IPv6 loopback")
    stop = threading.Event()
    t = threading.Thread(
        target=run_dns, args=(None, "10.0.0.2", stop), kwargs={"bind": ("::1", port)}, daemon=True
    )
    t.start()
    time.sleep(0.2)
    with socket.socket(socket.AF_INET6, socket.SOCK_DGRAM) as c:
        c.settimeout(2)
        c.sendto(_q(7), ("::1", port))
        assert DNS(c.recv(512)).id == 7
    stop.set()
    t.join(2)
