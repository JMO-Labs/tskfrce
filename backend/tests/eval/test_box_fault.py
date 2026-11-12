import pytest
from app.api import wifi as wifi_api
from app.core.config import settings
from app.eval import events, store
from app.services import network_wifi

URL = "/internal/eval/fault"


def _faults():
    return [
        r.body["payload"]["data"]
        for r in store.due(1e12, 100)
        if r.body["payload"]["name"] == "box_fault"
    ]


@pytest.fixture
def tok():
    return {"X-Internal-Token": settings.INTERNAL_TOKEN}


def test_allow_list_enums():
    assert events.FAULT_COMPONENTS == frozenset(
        {"blocker", "netd", "edge", "updater", "cert", "registry"}
    )
    assert events.FAULT_KINDS == frozenset(
        {"bind_fail", "hotspot_up", "join_fail", "rollback", "sig_fail", "update_fail",
         "cert_fail", "dns_fail", "report_fail", "crash"}
    )  # fmt: skip


def test_box_fault_rejects_unknown_and_free_text(eval_on):
    assert events.box_fault("blocker", "bind_fail") is True
    assert events.box_fault("blocker", "my-wifi-SSID") is False
    assert events.box_fault("nas.local", "crash") is False
    [d] = _faults()
    assert d["component"] == "blocker" and d["kind"] == "bind_fail"
    assert set(d) <= {"component", "kind", "household", "app_version", "source"}


def test_endpoint_needs_token(client, eval_on):
    assert client.post(URL, json={"component": "edge", "kind": "cert_fail"}).status_code == 403
    assert _faults() == []


def test_endpoint_emits(client, eval_on, tok):
    r = client.post(URL, json={"component": "edge", "kind": "cert_fail"}, headers=tok)
    assert r.status_code == 204
    assert _faults()[0]["kind"] == "cert_fail"


def test_endpoint_rejects_bad_values(client, eval_on, tok):
    r = client.post(URL, json={"component": "edge", "kind": "x.y"}, headers=tok)
    assert r.status_code == 422
    assert _faults() == []


def test_noop_when_stats_off(client, tok, monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "DATA_DIR", tmp_path)
    r = client.post(URL, json={"component": "edge", "kind": "cert_fail"}, headers=tok)
    assert r.status_code == 204
    assert events.box_fault("netd", "join_fail") is False
    assert not (tmp_path / "eval.db").exists()


@pytest.mark.parametrize(
    ("payload", "kind"),
    [
        ({"result": "failed", "version": "v1"}, "update_fail"),
        ({"result": "failed", "reason": "sig_fail"}, "sig_fail"),
        ({"result": "failed", "reason": "rollback"}, "rollback"),
    ],
)
def test_update_result_failed(client, eval_on, tok, payload, kind):
    assert client.post("/internal/update-result", json=payload, headers=tok).status_code == 200
    [d] = _faults()
    assert (d["component"], d["kind"]) == ("updater", kind)


def test_update_result_success_silent(client, eval_on, tok):
    client.post("/internal/update-result", json={"result": "success"}, headers=tok)
    assert _faults() == []


def test_wifi_join_failure(client, eval_on, parent_headers, monkeypatch):
    monkeypatch.setattr(
        network_wifi, "_call", lambda *a, **k: {"success": False, "error": "wrong_password"}
    )
    body = {"ssid": "HomeNet", "password": "hunter2hunter2"}
    client.post("/api/v1/network/wifi/join", json=body, headers=parent_headers)
    [d] = _faults()
    assert (d["component"], d["kind"]) == ("netd", "join_fail")
    assert "HomeNet" not in str(d)


def test_hotspot_raised_after_failed_setup(client, eval_on, monkeypatch):
    monkeypatch.setattr(wifi_api, "_last_phase", [None])
    monkeypatch.setattr(wifi_api, "client_ip", lambda r: "10.42.0.7")
    st = {"hotspot_active": True, "setup": {"phase": "failed", "error": "failed"}}
    monkeypatch.setattr(network_wifi, "_call", lambda *a, **k: st)
    for _ in range(3):
        assert client.get("/api/v1/network/wifi/setup/status").status_code == 200
    kinds = sorted(d["kind"] for d in _faults())
    assert kinds == ["hotspot_up", "join_fail"]
