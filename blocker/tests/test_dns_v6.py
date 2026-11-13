"""The IPv6 DNS listener runs once per service, not once per LAN address."""

from __future__ import annotations

import threading
import time
from unittest.mock import patch

from blocker import dns_v6


def test_retries_bind_until_it_succeeds():
    calls = []

    def fake(cfg, box, stop, bind, **kw):
        calls.append(bind)
        if len(calls) < 3:
            raise OSError("in use")

    dns_v6.serve(None, "10.0.0.2", threading.Event(), {}, run=fake, retry=0.01)
    assert calls == [("::", 53)] * 3


def test_stops_retrying_when_stop_set():
    stop = threading.Event()
    n = []

    def fake(cfg, box, stop_, bind, **kw):
        n.append(1)
        stop.set()
        raise OSError("no v6")

    dns_v6.serve(None, "10.0.0.2", stop, {}, run=fake, retry=0.01)
    assert len(n) == 1


def test_service_one_v6_listener_independent_of_per_address_stops():
    from blocker.tests.test_service import _svc

    svc, _fw, _redir = _svc()
    svc._portal_ip = "10.0.0.2"
    binds: list[tuple] = []
    v6_stops: list[threading.Event] = []

    def fake_run_dns(cfg, box, stop, bind=("0.0.0.0", 53), **kw):
        binds.append(bind)
        if bind[0] == "::":
            v6_stops.append(stop)
        stop.wait(2)

    with (
        patch("blocker.service.run_dns", fake_run_dns),
        patch("blocker.dns_v6.run_dns", fake_run_dns),
        patch("blocker.service.run_http", lambda *a, **k: None),
    ):
        svc._start_dns_v6()
        per_addr = [threading.Event() for _ in range(3)]
        for i, ev in enumerate(per_addr):
            threading.Thread(
                target=svc._serve_portal, args=(f"192.168.{i}.2", ev), daemon=True
            ).start()
        time.sleep(0.3)
        assert [b for b in binds if b[0] == "::"] == [("::", 53)]
        assert len([b for b in binds if b[0] != "::"]) == 3
        per_addr[0].set()
        time.sleep(0.7)
        assert not v6_stops[0].is_set()
        assert v6_stops[0] is svc._stop
        svc._stop.set()
        for ev in per_addr:
            ev.set()
