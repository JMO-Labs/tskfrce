"""Service x homework: no deadlock, gate->render->conntrack order, local `until`, reconcile."""

from __future__ import annotations

import threading
from unittest.mock import Mock

from blocker.backend import Seen
from test_service import FakeFirewall, _svc

MAC = "de:ad:be:ef:00:01"
DEV_IP = "192.168.1.50"


class HwFirewall(FakeFirewall):
    def __init__(self) -> None:
        super().__init__()
        self.log: list[tuple] = []

    def apply(self, ruleset: str) -> None:
        super().apply(ruleset)
        self.log.append(("apply", ruleset))

    def kill_conntrack(self, ips, device_ip=None) -> None:
        self.log.append(("kill", frozenset(ips), device_ip))

    def add_pairs(self, out, back) -> None:
        self.log.append(("add", dict(out), dict(back)))


def _hw(allow=("khan.org",), block=(), until="2099-01-01T00:00:00Z"):
    return {MAC: {"allow": list(allow), "block": list(block), "until": until}}


def _homework_svc(**kw):
    svc, _, _redir = _svc(**kw)
    fw = HwFirewall()
    svc._fw = fw
    svc._wiring.fw = fw
    svc._on_seen(Seen(mac=MAC, ip=DEV_IP, ipv6=[], hostname=None, vendor=None))
    svc.store.set_state([MAC], _hw())
    gate = svc._gate
    allowed, via, pulled = gate.decide(MAC, "khan.org")
    assert allowed
    gate.record(MAC, "khan.org", ["8.8.8.8"], 300, via, pulled)
    return svc, fw


def _in_thread(fn, timeout=5.0) -> bool:
    t = threading.Thread(target=fn, daemon=True)
    t.start()
    t.join(timeout)
    return not t.is_alive()


def test_apply_with_active_homework_pairs_does_not_deadlock():
    box = []  # setup pushes state -> _apply too, so it must run under the timeout as well
    assert _in_thread(lambda: box.append(_homework_svc())), "setup hung (deadlock)"
    svc, fw = box[0]
    assert _in_thread(svc._apply), "_apply hung: service lock re-entered (deadlock)"
    last = fw.applied[-1]
    assert "de:ad:be:ef:00:01 . 8.8.8.8 timeout" in last
    assert f"8.8.8.8 . {DEV_IP} timeout" in last


def test_state_push_with_homework_completes():
    svc, _ = _homework_svc()
    assert _in_thread(lambda: svc.store.set_state([MAC], _hw()))


def test_block_change_rerenders_before_conntrack_kill():
    svc, fw = _homework_svc()
    fw.log.clear()
    svc.store.set_state([MAC], _hw(block=["khan.org"]))
    kinds = [e[0] for e in fw.log]
    assert kinds == ["apply", "kill"]
    assert "8.8.8.8" not in fw.log[0][1]  # render already forgot the cut pair
    assert fw.log[1] == ("kill", frozenset({"8.8.8.8"}), DEV_IP)


def test_session_end_rerenders_then_kills_device():
    svc, fw = _homework_svc()
    fw.log.clear()
    svc.store.set_state([MAC], {})
    assert [e[0] for e in fw.log] == ["apply", "kill"]
    assert "8.8.8.8" not in fw.log[0][1]
    assert fw.log[1] == ("kill", frozenset(), DEV_IP)


def test_tick_ends_expired_session_without_backend():
    svc, fw = _homework_svc(report=Mock(side_effect=RuntimeError("backend down")))
    svc._watch = Mock()
    svc._gate._wall = lambda: 4_102_444_800.0 + 1  # past 2099-01-01
    fw.log.clear()
    try:
        svc._resist_once()
    except (RuntimeError, TypeError):
        pass  # backend/reporting broken: the until check must already have run
    assert [e[0] for e in fw.log] == ["apply", "kill"]
    assert not svc._gate.active(MAC)


def test_reconcile_keeps_homework_from_backend_state():
    state = {"blocked": [MAC], "homework": _hw()}
    svc, _ = _homework_svc(fetch_state=lambda _cfg: state)
    svc._sites = Mock()
    svc._reconcile_once()
    assert svc._gate.active(MAC)
    assert (MAC, "8.8.8.8") in svc._gate.pairs()  # same session, pairs kept


def test_dns_server_falls_back_to_detected_gateway_not_public_ip(monkeypatch):
    svc, _ = _homework_svc()
    svc._wiring.cfg = Mock(upstream_dns="")
    svc._wiring._gateway_ip = lambda: "192.168.1.1"
    handle = Mock(return_value=None)
    monkeypatch.setattr("blocker.hw_wiring.handle_homework", handle)
    svc._wiring.dns_handle(DEV_IP, b"q")
    assert handle.call_args[0][3] == "192.168.1.1"
