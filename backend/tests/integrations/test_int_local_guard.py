"""Local push LAN guard: fail closed on any forwarding header; configurable LAN ranges."""

import pytest
from app.core.config import settings
from app.main import app
from fastapi.testclient import TestClient
from tests.integrations.int_helpers import push

LAN = "192.168.1.50"
URL = "/api/v1/integration-local/push"
RELAY = [
    "x-forwarded-for",
    "forwarded",
    "x-forwarded-host",
    "x-forwarded-proto",
    "x-real-ip",
    "x-edge-token",
    "cf-connecting-ip",
    "true-client-ip",
    "x-client-ip",
    "cf-ray",
]


def peer(ip):
    return TestClient(app, base_url="http://localhost", client=(ip, 50000))


@pytest.fixture
def client(client):
    """Loopback peer: trusted proxy, so the frontend's X-Real-IP is honoured."""
    return peer("127.0.0.1")


def post(c, token, headers):
    return c.post(
        URL, json={"actions": []}, headers={"Authorization": f"Bearer {token}", **headers}
    )


@pytest.mark.parametrize("name", RELAY)
@pytest.mark.parametrize("value", ["", LAN, "203.0.113.9"])
def test_any_relay_header_from_untrusted_lan_peer_refused(local_key, name, value):
    """A tunnel or proxy on the LAN looks local; its forwarding header gives it away."""
    for spelling in (name, name.upper(), name.title()):
        r = post(peer(LAN), local_key.token, {spelling: value})
        assert r.status_code == 403, (spelling, value)


@pytest.mark.parametrize("name", [h for h in RELAY if h != "x-real-ip"])
@pytest.mark.parametrize("value", ["", LAN])
def test_relay_header_alongside_our_x_real_ip_refused(client, local_key, name, value):
    """Our frontend never sends these; their presence means something else relayed it."""
    r = post(client, local_key.token, {"X-Real-IP": LAN, name.title(): value})
    assert r.status_code == 403


@pytest.mark.parametrize("value", ["", "not-an-ip", f"{LAN}, 10.0.0.1"])
def test_bad_x_real_ip_from_trusted_proxy_refused(client, local_key, value):
    assert post(client, local_key.token, {"X-Real-IP": value}).status_code == 403


def test_genuine_lan_push_via_frontend_works(client, local_key):
    assert push(client, local_key.token, [], ip=LAN).status_code == 200


def test_direct_lan_peer_without_headers_works(local_key):
    assert post(peer(LAN), local_key.token, {}).status_code == 200


@pytest.mark.parametrize("ip", ["127.0.0.1", "::1", "169.254.1.1", "fe80::1"])
def test_loopback_and_link_local_refused(client, local_key, ip):
    assert push(client, local_key.token, [], ip=ip).status_code == 403


def test_loopback_peer_without_headers_refused(client, local_key):
    """A tunnel on the box itself (cloudflared -> localhost) arrives as loopback."""
    assert post(client, local_key.token, {}).status_code == 403


@pytest.mark.parametrize(
    "ip", ["172.29.40.1", "172.29.50.1", "fd00:4ce::1", "172.17.0.1", "172.17.0.5"]
)
def test_docker_gateway_and_bridge_refused(client, local_key, ip):
    """Host tunnels reach the frontend via docker-proxy, i.e. from the bridge gateway."""
    assert push(client, local_key.token, [], ip=ip).status_code == 403


@pytest.mark.parametrize("ip", ["10.1.2.3", "172.16.0.9", "192.168.0.2", "fd12:3456::5"])
def test_default_lan_ranges_allowed(client, local_key, ip):
    assert push(client, local_key.token, [], ip=ip).status_code == 200


def test_custom_cidrs(client, local_key, monkeypatch):
    monkeypatch.setattr(settings, "LOCAL_PUSH_CIDRS", "192.168.7.0/24, 100.64.0.0/10")
    monkeypatch.setattr(settings, "LOCAL_PUSH_EXCLUDE_CIDRS", "192.168.7.99/32")
    assert push(client, local_key.token, [], ip="192.168.7.5").status_code == 200
    assert push(client, local_key.token, [], ip="100.64.1.2").status_code == 200
    assert push(client, local_key.token, [], ip="192.168.7.99").status_code == 403
    assert push(client, local_key.token, [], ip=LAN).status_code == 403
    assert push(client, local_key.token, [], ip="10.1.2.3").status_code == 403


def test_custom_exclude_overrides_include(client, local_key, monkeypatch):
    monkeypatch.setattr(settings, "LOCAL_PUSH_EXCLUDE_CIDRS", "192.168.1.0/24")
    assert push(client, local_key.token, [], ip=LAN).status_code == 403
    assert push(client, local_key.token, [], ip="192.168.2.5").status_code == 200
