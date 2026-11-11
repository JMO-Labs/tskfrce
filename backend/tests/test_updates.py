"""Updates API tests."""

import pytest


@pytest.fixture(autouse=True)
def _own_state_file(tmp_path, monkeypatch):
    """Every test gets its own update-state.json (parallel CI shared one and leaked 'off')."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.delenv("UPDATE_CHANNEL", raising=False)


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
    monkeypatch.setenv("UPDATE_CHANNEL", "eval")

    resp = client.patch(
        "/api/v1/updates",
        headers=parent_headers,
        json={"channel": "stable"},
    )
    assert resp.status_code == 409
    assert "cannot switch to stable" in resp.json()["detail"]


def test_unauthenticated_access_returns_401(client):
    """GET /api/v1/updates without auth returns 401."""
    resp = client.get("/api/v1/updates")
    assert resp.status_code == 401


def test_internal_kid_session_endpoint_requires_token(client):
    """GET /internal/kid-session-active without token returns 401."""
    resp = client.get("/internal/kid-session-active")
    assert resp.status_code == 403


def test_internal_update_result_requires_token(client):
    """POST /internal/update-result without the internal token is refused."""
    resp = client.post("/internal/update-result", json={"result": "success"})
    assert resp.status_code == 403


def test_eval_cannot_pull_major(client, parent_headers, monkeypatch):
    """Hard rule: eval boxes cannot pull major versions (409, state stays eval)."""
    monkeypatch.setenv("UPDATE_CHANNEL", "eval")

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


def test_eval_respects_off_channel(client, parent_headers, monkeypatch):
    """On eval installs, "off" channel is respected (not coerced to eval)."""
    monkeypatch.setenv("UPDATE_CHANNEL", "eval")

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


@pytest.fixture
def internal_headers():
    from app.core.config import settings

    return {"X-Internal-Token": settings.INTERNAL_TOKEN}


def test_update_state_forces_eval_on_eval_install(client, internal_headers, monkeypatch):
    monkeypatch.setenv("UPDATE_CHANNEL", "eval")
    r = client.get("/internal/update-state", headers=internal_headers)
    assert r.status_code == 200 and r.json() == {"channel": "eval", "requested_major": None}


def test_kid_session_active_follows_running_timers(client, db, internal_headers):
    from datetime import UTC, datetime, timedelta

    from app.models.lock import Device, Override

    assert client.get("/internal/kid-session-active", headers=internal_headers).json() == {
        "active": False
    }
    dev = Device(mac="aa:bb:cc:00:00:01", name="tablet")
    db.add(dev)
    db.flush()
    db.add(
        Override(
            device_id=dev.id,
            action="unlock",
            source="manual",
            expires_at=datetime.now(UTC).replace(tzinfo=None) + timedelta(minutes=20),
        )
    )
    db.commit()
    assert client.get("/internal/kid-session-active", headers=internal_headers).json() == {
        "active": True
    }


def test_update_result_records_and_notifies_parents(
    client, db, parent, parent_headers, internal_headers
):
    r = client.post(
        "/internal/update-result",
        headers=internal_headers,
        json={"result": "failed", "version": "2.15.0", "old_version": "2.14.0"},
    )
    assert r.status_code == 200
    assert client.get("/api/v1/updates", headers=parent_headers).json()["last_result"] == "failed"
    from app.models.inbox import Notification

    n = db.query(Notification).filter(Notification.kind == "box_update").one()
    assert "2.15.0" in n.title and "2.14.0" in (n.body or "")
