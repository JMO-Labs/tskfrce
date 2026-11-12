"""SNI gate resource limits: per-device window budgets, lifetimes, concurrency."""

import socket
import threading
import time

import pytest

from blocker import sni_gate
from blocker.tests.test_sni_gate import _hello


@pytest.fixture(autouse=True)
def _fresh_budgets(monkeypatch):
    monkeypatch.setattr(sni_gate, "_use", {})


def test_window_budget_caps_connections_per_device_and_resets():
    for _ in range(sni_gate.WINDOW_CONNS):
        assert sni_gate._admit("10.0.0.9", 100.0)
    assert not sni_gate._admit("10.0.0.9", 101.0)
    assert sni_gate._admit("10.0.0.8", 101.0)  # per device
    assert sni_gate._admit("10.0.0.9", 100.0 + sni_gate.WINDOW)


def test_window_budget_caps_bytes_per_device():
    assert sni_gate._admit("10.0.0.9", 100.0)
    assert sni_gate._charge("10.0.0.9", sni_gate.WINDOW_BYTES, 100.0)
    assert not sni_gate._charge("10.0.0.9", 1, 100.0)
    assert not sni_gate._admit("10.0.0.9", 101.0)  # spent: no new connections this window
    assert sni_gate._admit("10.0.0.9", 100.0 + sni_gate.WINDOW)


def test_silent_client_is_closed_at_the_hello_deadline(monkeypatch):
    monkeypatch.setattr(sni_gate, "HELLO_DEADLINE", 0.3)
    a, b = socket.socketpair()
    t = threading.Thread(target=sni_gate._serve, args=(b,), daemon=True)
    t0 = time.monotonic()
    t.start()
    a.settimeout(5)
    hello = _hello("www.google.com")
    for i in range(20):  # trickle: each byte resets an idle timer, not the deadline
        try:
            a.send(hello[i : i + 1])
        except OSError:
            break
        time.sleep(0.1)
    try:
        assert a.recv(1) == b""
    except ConnectionResetError:
        pass
    assert time.monotonic() - t0 < 1.5
    t.join(2)


def _stalled(monkeypatch, talker: str | None, **limits) -> float:
    """Pass a connection that never finishes; `talker` ("client"/"server") keeps sending small
    records. Seconds until the client sees EOF."""
    for k, v in limits.items():
        monkeypatch.setattr(sni_gate, k, v)
    a, b = socket.socketpair()
    up_a, up_b = socket.socketpair()
    t = threading.Thread(
        target=sni_gate._serve, args=(b,), kwargs={"connect": lambda *_, **__: up_a}, daemon=True
    )
    t0 = time.monotonic()
    t.start()
    a.settimeout(10)
    a.sendall(_hello("www.google.com"))
    up_b.recv(65536)
    side, rec = {
        "client": (a, b"\x17\x03\x03\x00\x01x"),
        "server": (up_b, b"\x16\x03\x03\x00\x01x"),
    }.get(talker, (None, b""))

    def talk():
        for _ in range(40):
            try:
                side.send(rec)
            except OSError:
                return
            time.sleep(0.1)

    if side:
        threading.Thread(target=talk, daemon=True).start()
    while a.recv(65536):
        pass
    took = time.monotonic() - t0
    t.join(5)
    up_b.close()
    return took


@pytest.mark.parametrize("talker", [None, "client", "server"])
def test_connection_idle_on_either_side_is_closed(monkeypatch, talker):
    assert _stalled(monkeypatch, talker, IDLE=0.3, LIFETIME=30.0) < 2


def test_busy_connection_still_ends_at_its_lifetime(monkeypatch):
    assert _stalled(monkeypatch, "client", IDLE=30.0, LIFETIME=0.5) < 2.5


def test_gate_refuses_connections_beyond_the_thread_bound(monkeypatch):
    monkeypatch.setattr(sni_gate, "MAX_CONNS", 1)
    hold = threading.Event()
    monkeypatch.setattr(sni_gate, "_serve", lambda conn: hold.wait(5) or conn.close())
    probe = socket.socket()
    probe.bind(("127.0.0.1", 0))
    port = probe.getsockname()[1]
    probe.close()
    stop = threading.Event()
    threading.Thread(target=sni_gate.run_gate, args=(stop, "127.0.0.1", port), daemon=True).start()
    time.sleep(0.3)
    first = socket.create_connection(("127.0.0.1", port), timeout=3)
    time.sleep(0.2)
    second = socket.create_connection(("127.0.0.1", port), timeout=3)
    assert second.recv(1) == b""  # refused: closed at once
    first.settimeout(0.3)
    with pytest.raises(TimeoutError):
        first.recv(1)  # still held by its handler
    hold.set()
    stop.set()
    first.close()
    second.close()


def test_gate_caps_open_connections_per_source_at_accept(monkeypatch):
    monkeypatch.setattr(sni_gate, "PER_SOURCE", 1)
    hold = threading.Event()
    served = []
    monkeypatch.setattr(
        sni_gate, "_serve", lambda conn: served.append(1) or hold.wait(5) or conn.close()
    )
    probe = socket.socket()
    probe.bind(("127.0.0.1", 0))
    port = probe.getsockname()[1]
    probe.close()
    stop = threading.Event()
    threading.Thread(target=sni_gate.run_gate, args=(stop, "127.0.0.1", port), daemon=True).start()
    time.sleep(0.3)
    first = socket.create_connection(("127.0.0.1", port), timeout=3)
    time.sleep(0.2)
    second = socket.create_connection(("127.0.0.1", port), timeout=3)
    assert second.recv(1) == b""  # same source over its cap: closed before any handler runs
    assert served == [1]
    hold.set()
    time.sleep(0.3)
    third = socket.create_connection(("127.0.0.1", port), timeout=3)  # slot freed
    time.sleep(0.3)
    assert served == [1, 1]
    stop.set()
    for s in (first, second, third):
        s.close()
