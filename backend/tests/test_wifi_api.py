"""Wi-Fi API: parent-only Settings routes; captive routes gated to the hotspot."""

import pytest
from app.api import wifi as wifi_api
from app.services import network_wifi

HOTSPOT = {"hotspot_active": True, "setup": {"phase": "idle", "error": None}}


@pytest.fixture
def daemon(monkeypatch):
    calls = []

    def fake(cmd, timeout=15, **kw):
        calls.append((cmd, kw))
        return {"status": HOTSPOT}.get(cmd, {"success": True})

    monkeypatch.setattr(network_wifi, "_call", fake)
    return calls


def test_settings_routes_need_parent(client, kid_headers, daemon):
    assert client.get("/api/v1/network/wifi/status").status_code == 401
    assert client.get("/api/v1/network/wifi/status", headers=kid_headers).status_code == 403
    assert daemon == []


def test_settings_join_validates_then_calls_daemon(client, parent_headers, daemon):
    bad = client.post(
        "/api/v1/network/wifi/join",
        headers=parent_headers,
        json={"ssid": "a\nb", "password": "x" * 10},
    )
    assert bad.status_code == 400 and daemon == []
    ok = client.post(
        "/api/v1/network/wifi/join",
        headers=parent_headers,
        json={"ssid": "Home", "password": "x" * 10},
    )
    assert ok.status_code == 200 and daemon[-1][0] == "join"


def test_daemon_down_is_503(client, parent_headers, monkeypatch):
    def down(*a, **k):
        raise RuntimeError("down")

    monkeypatch.setattr(network_wifi, "_call", down)
    assert client.get("/api/v1/network/wifi/status", headers=parent_headers).status_code == 503


SETUP = "/api/v1/network/wifi/setup/join"
BODY = {"ssid": "Home", "password": "x" * 10}


@pytest.fixture
def via_proxy(monkeypatch):
    """Pretend the request came through our trusted proxy (client_ip has its own tests)."""
    monkeypatch.setattr(wifi_api, "client_ip", lambda r: r.headers.get("x-real-ip", ""))


def test_spoofed_real_ip_from_untrusted_peer_rejected(client, daemon):
    # No via_proxy: the TestClient peer is not a trusted proxy, so X-Real-IP is ignored.
    r = client.post(SETUP, json=BODY, headers={"X-Real-IP": "10.42.0.5"})
    assert r.status_code == 403


def test_setup_join_rejects_lan_clients_even_with_token(client, daemon, via_proxy):
    r = client.post(SETUP, json=BODY, headers={"X-Real-IP": "192.168.1.50"})
    assert r.status_code == 403
    assert all(c[0] != "setup_join" for c in daemon)


def test_setup_join_refused_when_hotspot_down(client, monkeypatch, via_proxy):
    monkeypatch.setattr(
        network_wifi, "_call", lambda cmd, timeout=15, **kw: {"hotspot_active": False, "setup": {}}
    )
    r = client.post(SETUP, json=BODY, headers={"X-Real-IP": "10.42.0.5"})
    assert r.status_code == 409


def test_setup_join_from_hotspot_client(client, daemon, via_proxy):
    r = client.post(SETUP, json=BODY, headers={"X-Real-IP": "10.42.0.5"})
    assert r.status_code == 200, r.text
    assert daemon[-1] == (
        "setup_join",
        {"ssid": "Home", "password": "x" * 10, "security": "wpa", "hidden": False},
    )


def test_join_refused_while_connecting_but_status_allowed(client, monkeypatch, via_proxy):
    state = {"hotspot_active": False, "setup": {"phase": "connecting", "error": None}}
    monkeypatch.setattr(network_wifi, "_call", lambda cmd, timeout=15, **kw: state)
    h = {"X-Real-IP": "10.42.0.5"}
    assert client.post(SETUP, json=BODY, headers=h).status_code == 409
    r = client.get("/api/v1/network/wifi/setup/status", headers=h)
    assert r.status_code == 200 and r.json()["phase"] == "connecting"


def test_settings_join_open_hidden_needs_no_password(client, parent_headers, daemon):
    body = {"ssid": "Guest", "security": "open", "hidden": True}
    r = client.post("/api/v1/network/wifi/join", headers=parent_headers, json=body)
    assert r.status_code == 200
    assert daemon[-1] == (
        "join",
        {"ssid": "Guest", "password": "", "security": "open", "hidden": True},
    )


def test_unknown_security_type_is_422(client, parent_headers, daemon):
    body = {"ssid": "Home", "password": "x" * 10, "security": "wep"}
    assert (
        client.post("/api/v1/network/wifi/join", headers=parent_headers, json=body).status_code
        == 422
    )
