"""Tests for networks API: auth and enforcement toggle."""

import pytest
from app.models.network import Network
from sqlalchemy.orm import Session


@pytest.fixture
def network(db: Session):
    """Create a network for testing."""
    net = Network(
        iface="eno2",
        subnet="192.168.1.0/24",
        auto_label="Wired",
        custom_label=None,
        enforce=True,
    )
    db.add(net)
    db.commit()
    db.refresh(net)
    return net


def test_list_networks_parent_200(client, parent_headers, network):
    """Parent can list networks."""
    response = client.get("/api/v1/networks", headers=parent_headers)
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) >= 1
    assert data[0]["iface"] == "eno2"


def test_list_networks_kid_403(client, kid_headers, network):
    """Kid cannot list networks (403)."""
    response = client.get("/api/v1/networks", headers=kid_headers)
    assert response.status_code == 403


def test_list_networks_unauth_401(client, network):
    """Unauthenticated request gets 401."""
    response = client.get("/api/v1/networks")
    assert response.status_code == 401


def test_update_network_parent_200(client, parent_headers, network):
    """Parent can rename network and toggle enforce."""
    # Rename
    response = client.patch(
        f"/api/v1/networks/{network.id}",
        json={"custom_label": "My Wired Network"},
        headers=parent_headers,
    )
    assert response.status_code == 200
    assert response.json()["label"] == "My Wired Network"

    # Toggle enforce off
    response = client.patch(
        f"/api/v1/networks/{network.id}",
        json={"enforce": False},
        headers=parent_headers,
    )
    assert response.status_code == 200
    assert response.json()["enforce"] is False


def test_update_network_kid_403(client, kid_headers, network):
    """Kid cannot update network (403)."""
    response = client.patch(
        f"/api/v1/networks/{network.id}",
        json={"enforce": False},
        headers=kid_headers,
    )
    assert response.status_code == 403


def test_update_network_unauth_401(client, network):
    """Unauthenticated request gets 401."""
    response = client.patch(
        f"/api/v1/networks/{network.id}",
        json={"enforce": False},
    )
    assert response.status_code == 401


def test_network_not_found_404(client, parent_headers):
    """Updating nonexistent network returns 404."""
    response = client.patch(
        "/api/v1/networks/999",
        json={"enforce": False},
        headers=parent_headers,
    )
    assert response.status_code == 404


def _patch(client, headers, net, body):
    return client.patch(f"/api/v1/networks/{net.id}", json=body, headers=headers)


def test_update_network_response_shape(client, parent_headers, network):
    """PATCH returns the same shape as the list endpoint."""
    r = _patch(client, parent_headers, network, {"custom_label": "  Den  "})
    assert r.status_code == 200
    body = r.json()
    listed = client.get("/api/v1/networks", headers=parent_headers).json()[0]
    assert body == listed
    assert body["custom_label"] == "Den"
    assert body["subnet"] == "192.168.1.0/24"


@pytest.mark.parametrize("value", [None, "", "   "])
def test_update_network_clear_label(client, parent_headers, network, value):
    """null/empty custom_label clears back to the auto label."""
    _patch(client, parent_headers, network, {"custom_label": "Den"})
    r = _patch(client, parent_headers, network, {"custom_label": value})
    assert r.status_code == 200
    assert r.json()["custom_label"] is None
    assert r.json()["label"] == "Wired"


def test_update_network_label_too_long_422(client, parent_headers, network):
    assert _patch(client, parent_headers, network, {"custom_label": "x" * 41}).status_code == 422
    assert _patch(client, parent_headers, network, {"custom_label": "x" * 40}).status_code == 200


@pytest.mark.parametrize(
    "body",
    [{"enforce": "false"}, {"enforce": 0}, {"custom_label": 5}, {"bogus": 1}],
)
def test_update_network_invalid_body_422(client, parent_headers, network, body):
    assert _patch(client, parent_headers, network, body).status_code == 422
