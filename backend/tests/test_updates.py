"""Updates API tests."""


def test_get_updates(api_client):
    """GET /api/v1/updates returns current status."""
    resp = api_client.get("/api/v1/updates")
    assert resp.status_code == 200
    data = resp.json()
    assert "version" in data
    assert "channel" in data
    assert "last_result" in data
    assert "major_available" in data
    assert data["channel"] in {"stable", "eval", "off"}


def test_patch_updates_channel(api_client):
    """PATCH /api/v1/updates with channel changes the setting."""
    resp = api_client.patch("/api/v1/updates", json={"channel": "off"})
    assert resp.status_code == 200
    assert resp.json()["channel"] == "off"

    resp = api_client.patch("/api/v1/updates", json={"channel": "stable"})
    assert resp.status_code == 200
    assert resp.json()["channel"] == "stable"


def test_patch_updates_invalid_channel(api_client):
    """PATCH with invalid channel returns 400."""
    resp = api_client.patch("/api/v1/updates", json={"channel": "invalid"})
    assert resp.status_code == 400
