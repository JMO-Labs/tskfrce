"""Updates API tests."""

import json
from pathlib import Path


def test_get_updates_returns_status(client, parent_headers, tmp_path, monkeypatch):
    """GET /api/v1/updates returns current status (requires parent auth)."""
    # Monkeypatch data dir for state file
    monkeypatch.setenv("DATA_DIR", str(tmp_path))

    resp = client.get("/api/v1/updates", headers=parent_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "version" in data
    assert "channel" in data
    assert data["channel"] in {"stable", "eval", "off"}


def test_patch_updates_channel(client, parent_headers, tmp_path, monkeypatch):
    """PATCH /api/v1/updates with channel changes the setting."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))

    resp = client.patch(
        "/api/v1/updates",
        headers=parent_headers,
        json={"channel": "off"},
    )
    assert resp.status_code == 200
    assert resp.json()["channel"] == "off"

    resp = client.patch(
        "/api/v1/updates",
        headers=parent_headers,
        json={"channel": "stable"},
    )
    assert resp.status_code == 200
    assert resp.json()["channel"] == "stable"


def test_patch_updates_invalid_channel(client, parent_headers):
    """PATCH with invalid channel returns 400."""
    resp = client.patch(
        "/api/v1/updates",
        headers=parent_headers,
        json={"channel": "invalid"},
    )
    assert resp.status_code == 400


def test_eval_channel_cannot_switch_to_stable(client, parent_headers, monkeypatch):
    """Hard rule: eval install cannot switch to stable (409)."""
    # Mock install-time channel as eval by setting UPDATE_CHANNEL in .env
    monkeypatch.setenv("HOME", "/tmp")
    tmp_env = Path("/tmp/.env")
    tmp_env.write_text("UPDATE_CHANNEL=eval\n")

    resp = client.patch(
        "/api/v1/updates",
        headers=parent_headers,
        json={"channel": "stable"},
    )
    assert resp.status_code == 409
    assert "cannot switch to stable" in resp.json()["detail"]

    tmp_env.unlink()


def test_unauthenticated_access_returns_401(client):
    """GET /api/v1/updates without auth returns 401."""
    resp = client.get("/api/v1/updates")
    assert resp.status_code == 401


def test_internal_kid_session_endpoint_requires_token(client):
    """GET /internal/kid-session-active without token returns 401."""
    resp = client.get("/internal/kid-session-active")
    assert resp.status_code == 401


def test_internal_today_note_endpoint_requires_token(client):
    """POST /internal/today-note without token returns 401."""
    resp = client.post("/internal/today-note", json={"note": "test"})
    assert resp.status_code == 401


def test_eval_cannot_pull_major(client, parent_headers, monkeypatch):
    """Hard rule: eval boxes cannot pull major versions (409, state stays eval)."""
    monkeypatch.setenv("HOME", "/tmp")
    tmp_env = Path("/tmp/.env")
    tmp_env.write_text("UPDATE_CHANNEL=eval\n")

    resp = client.patch(
        "/api/v1/updates",
        headers=parent_headers,
        json={"pull_major": "3"},
    )
    assert resp.status_code == 409
    assert "cannot" in resp.json()["detail"].lower()

    # Verify state stayed eval
    status = client.get("/api/v1/updates", headers=parent_headers).json()
    assert status["channel"] == "eval"

    tmp_env.unlink()


def test_eval_respects_off_channel(client, parent_headers, monkeypatch):
    """On eval installs, "off" channel is respected (not coerced to eval)."""
    monkeypatch.setenv("HOME", "/tmp")
    tmp_env = Path("/tmp/.env")
    tmp_env.write_text("UPDATE_CHANNEL=eval\n")

    # Set channel to off (user disables updates)
    resp = client.patch(
        "/api/v1/updates",
        headers=parent_headers,
        json={"channel": "off"},
    )
    assert resp.status_code == 200
    assert resp.json()["channel"] == "off"

    # Verify it stays off when read
    status = client.get("/api/v1/updates", headers=parent_headers).json()
    assert status["channel"] == "off"

    tmp_env.unlink()
