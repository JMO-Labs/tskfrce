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
