from pathlib import Path
from types import SimpleNamespace

from blocker import service as svc_mod
from blocker.config import Config
from blocker.service import Service

CFG = Config(
    backend_url="http://b",
    blocker_url_host="b",
    internal_token="t",
    lan_iface="",
    data_dir=Path("/tmp"),
)


class _FakeFw:
    def apply(self, r):
        pass

    def flush(self):
        pass

    def enable_forwarding(self):
        pass


class _FakeRedir:
    def set_targets(self, t):
        pass

    def stop_all(self):
        pass


def test_start_binds_control_api_to_loopback(monkeypatch):
    seen = {}

    class FakeServer:
        def serve_forever(self):
            pass

        def shutdown(self):
            pass

    def fake_make_api(state, token, tester, host, port, **kw):
        seen["host"] = host
        return FakeServer()

    # Stub the long-running loops so start() only exercises the API bind.
    monkeypatch.setattr(svc_mod, "make_api", fake_make_api)
    monkeypatch.setattr(svc_mod, "run_discovery", lambda *a, **k: None)
    monkeypatch.setattr(svc_mod, "run_dns", lambda *a, **k: None)
    monkeypatch.setattr(svc_mod, "run_http", lambda *a, **k: None)

    watch = SimpleNamespace(set_watched=lambda m: None, stop=lambda: None)
    svc = Service(
        CFG, firewall=_FakeFw(), redirection=_FakeRedir(), portal_ip="192.168.1.2", watch=watch
    )
    svc.start()
    svc.stop()
    assert seen["host"] == "127.0.0.1"


class _Srv:
    server_address = ("x", 7777)

    def serve_forever(self):
        pass

    def shutdown(self):
        pass


def _svc():
    watch = SimpleNamespace(set_watched=lambda m: None, stop=lambda: None)
    return Service(
        CFG, firewall=_FakeFw(), redirection=_FakeRedir(), portal_ip="192.168.1.2", watch=watch
    )


def test_bridge_bind_retries_without_rebinding_loopback(monkeypatch):
    calls = []
    fails = {"172.29.50.1": 2}

    def fake_make_api(state, token, tester, host, port, **kw):
        calls.append(host)
        if fails.get(host, 0) > 0:
            fails[host] -= 1
            raise OSError(99, "Cannot assign requested address")
        return _Srv()

    monkeypatch.setattr(svc_mod, "make_api", fake_make_api)
    monkeypatch.setattr(Service, "_spawn", lambda self, t: t())  # run threads inline
    svc = _svc()
    monkeypatch.setattr(svc._stop, "wait", lambda t: False)  # no real sleeping
    svc._start_api_multi(["127.0.0.1", "172.29.50.1"], 7777)
    assert calls.count("127.0.0.1") == 1  # loopback bound once, never rebound
    assert calls.count("172.29.50.1") == 3  # two failures, then success
    assert len(svc._api_servers) == 2


def test_loopback_bind_failure_stops_and_flags(monkeypatch):
    def fake_make_api(state, token, tester, host, port, **kw):
        raise OSError(98, "Address in use")

    monkeypatch.setattr(svc_mod, "make_api", fake_make_api)
    svc = _svc()
    stopped = []
    monkeypatch.setattr(svc, "stop", lambda: stopped.append(1))
    svc._start_api_multi(["127.0.0.1", "172.29.50.1"], 7777)
    assert svc.failed and stopped == [1]
