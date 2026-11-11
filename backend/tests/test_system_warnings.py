from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest
from app.models.family import get_family
from app.models.network import Network
from app.services import network_wifi, system_warnings

URL = "/api/v1/system/warnings"


@pytest.fixture(autouse=True)
def _env(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    # default: Wi-Fi daemon absent (stubbed off), plenty of disk
    monkeypatch.setattr(network_wifi, "status", lambda: (_ for _ in ()).throw(RuntimeError("x")))
    monkeypatch.setattr(
        system_warnings.shutil, "disk_usage", lambda p: SimpleNamespace(total=100, used=10, free=90)
    )


def _keys(client, h):
    r = client.get(URL, headers=h)
    assert r.status_code == 200, r.text
    return [w["key"] for w in r.json()["items"]]


def _blocker(db, age_min, enforce=True):
    get_family(db).blocker_last_seen = datetime.utcnow() - timedelta(minutes=age_min)
    db.add(Network(iface="eno1", subnet="10.0.0.0/24", auto_label="Wired", enforce=enforce))
    db.commit()


def test_requires_parent(client):
    assert client.get(URL).status_code in (401, 403)


def test_quiet_when_nothing_wrong(client, parent_headers):
    assert _keys(client, parent_headers) == []


def test_blocker_never_reported_is_not_a_warning(client, parent_headers):
    assert "blocker.down" not in _keys(client, parent_headers)


def test_blocker_stale_warns(client, parent_headers, db):
    _blocker(db, 30)
    assert "blocker.down" in _keys(client, parent_headers)


def test_blocker_fresh_ok(client, parent_headers, db):
    _blocker(db, 1)
    assert "blocker.down" not in _keys(client, parent_headers)


def test_blocker_protecting_no_network_warns(client, parent_headers, db):
    _blocker(db, 1, enforce=False)
    assert "blocker.down" in _keys(client, parent_headers)


def test_wifi_down_no_route(client, parent_headers, monkeypatch):
    monkeypatch.setattr(network_wifi, "status", lambda: {"online": False})
    items = client.get(URL, headers=parent_headers).json()["items"]
    w = next(i for i in items if i["key"] == "wifi.down")
    assert w["title"] and w["body"] and w["action"]["to"]


def test_wifi_online_ok(client, parent_headers, monkeypatch):
    monkeypatch.setattr(network_wifi, "status", lambda: {"online": True})
    assert "wifi.down" not in _keys(client, parent_headers)


def test_unhealthy_rollback(client, parent_headers):
    from app.api import updates

    updates._write_state({"last_result": "failed", "rollback_unhealthy": True})
    assert "update.unhealthy" in _keys(client, parent_headers)
    updates._write_state({"last_result": "success"})
    assert "update.unhealthy" not in _keys(client, parent_headers)


def test_storage_nearly_full(client, parent_headers, monkeypatch):
    monkeypatch.setattr(
        system_warnings.shutil, "disk_usage", lambda p: SimpleNamespace(total=100, used=95, free=5)
    )
    assert "storage.full" in _keys(client, parent_headers)


def test_bind_failure_source_is_stubbed_off(client, parent_headers):
    assert "blocker.bind" not in _keys(client, parent_headers)
