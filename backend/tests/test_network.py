"""VLAN coverage: internal report, parent API, listen-only state."""

import os
import subprocess
import sys

from app.core.config import settings
from app.models.family import get_family
from app.models.lock import Device, Vlan
from sqlalchemy import create_engine, inspect

from tests.test_migrations import BACKEND

VLANS = "/api/v1/internal/vlans"
STATE = "/api/v1/internal/state"
SEEN = "/api/v1/internal/devices/seen"
MAC = {"mac": "aa:bb:cc:dd:ee:10", "ip": "10.0.0.9"}


def tok():
    return {"X-Internal-Token": settings.INTERNAL_TOKEN}


def post(client, vlans):
    return client.post(VLANS, json={"vlans": vlans}, headers=tok())


def test_vlans_requires_token(client):
    assert client.post(VLANS, json={"vlans": []}).status_code == 403


def test_vlans_upsert_never_deletes(client, db):
    r = post(client, [{"vid": 20, "macs": 6, "subnet": "192.168.20.0/24"}, {"vid": 30, "macs": 2}])
    assert r.status_code == 200 and r.json() == {"count": 2}
    first = db.get(Vlan, 20).first_seen
    post(client, [{"vid": 20, "macs": 9, "subnet": None}])  # 30 absent: kept
    db.expire_all()
    v = db.get(Vlan, 20)
    assert (v.device_count, v.subnet, v.first_seen) == (9, "192.168.20.0/24", first)
    assert db.get(Vlan, 30) is not None and v.covered is False


def test_vlans_validation(client):
    for bad in ({"vid": 0}, {"vid": 4095}, {"vid": 5, "subnet": "nope"}, {"vid": 5, "macs": -1}):
        assert post(client, [bad]).status_code == 422
    assert post(client, [{"vid": 1 + i % 4094} for i in range(4095)]).status_code == 422
    assert post(client, [{"vid": 1 + i} for i in range(4094)]).json() == {"count": 4094}


def test_seen_vid_stored_and_kept_when_absent(client, db):
    client.post(SEEN, json={**MAC, "vid": 20}, headers=tok())
    assert db.query(Device).one().vlan_id == 20
    client.post(SEEN, json=MAC, headers=tok())  # key absent: unchanged
    db.expire_all()
    assert db.query(Device).one().vlan_id == 20
    client.post(SEEN, json={**MAC, "vid": None}, headers=tok())  # explicit null: untagged
    db.expire_all()
    assert db.query(Device).one().vlan_id is None
    assert client.post(SEEN, json={**MAC, "vid": 9999}, headers=tok()).status_code == 422


def test_state_shape_covered_and_listen_only(client, db):
    get_family(db).new_devices_blocked = True
    db.commit()
    client.post(SEEN, json=MAC, headers=tok())
    post(client, [{"vid": 30}, {"vid": 20}])
    db.get(Vlan, 30).covered = True
    db.get(Vlan, 20).covered = True
    db.commit()
    s = client.get(STATE, headers=tok()).json()
    assert s == {
        "blocked": [MAC["mac"]],
        "homework": {},
        "listen_only": False,
        "covered_vlans": [20, 30],
        "network_enforce": {},
    }
    get_family(db).listen_only = True
    db.commit()
    s = client.get(STATE, headers=tok()).json()
    assert s["blocked"] == [] and s["listen_only"] is True


def test_network_requires_parent(client, kid_headers):
    assert client.get("/api/v1/network").status_code in (401, 403)
    assert client.get("/api/v1/network", headers=kid_headers).status_code == 403
    assert client.patch("/api/v1/network", json={"listen_only": True}).status_code in (401, 403)


def test_network_get_and_patch(client, parent_headers):
    r = client.get("/api/v1/network", headers=parent_headers).json()
    assert r == {"listen_only": False, "trunk_detected": False, "vlans": []}
    post(client, [{"vid": 20, "macs": 3, "subnet": "192.168.20.0/24"}])
    r = client.get("/api/v1/network", headers=parent_headers).json()
    assert r["trunk_detected"] is True
    v = r["vlans"][0]
    assert v["vid"] == 20 and v["device_count"] == 3 and v["covered"] is False and v["name"] is None
    assert v["last_seen"].endswith("Z")
    r = client.patch("/api/v1/network", json={"listen_only": True}, headers=parent_headers)
    assert r.status_code == 200 and r.json()["listen_only"] is True
    assert client.patch("/api/v1/network", json={}, headers=parent_headers).status_code == 422
    assert client.get("/api/v1/family", headers=parent_headers).json()["listen_only"] is True
    r = client.patch("/api/v1/family", json={"listen_only": False}, headers=parent_headers)
    assert r.json()["listen_only"] is False


def test_patch_vlan(client, parent_headers):
    post(client, [{"vid": 20}])
    u = "/api/v1/network/vlans/20"
    r = client.patch(u, json={"name": "Kids", "covered": True}, headers=parent_headers)
    assert r.status_code == 200 and r.json()["name"] == "Kids" and r.json()["covered"] is True
    r = client.patch(u, json={"covered": False}, headers=parent_headers)
    assert r.json()["name"] == "Kids" and r.json()["covered"] is False
    assert client.patch(u, json={"name": "x" * 51}, headers=parent_headers).status_code == 422
    assert (
        client.patch("/api/v1/network/vlans/99", json={}, headers=parent_headers).status_code == 404
    )
    assert client.patch(u, json={"covered": True}).status_code in (401, 403)


def test_devices_include_vlan_id(client, parent_headers):
    client.post(SEEN, json={**MAC, "vid": 20}, headers=tok())
    d = client.get("/api/v1/devices", headers=parent_headers).json()[0]
    assert d["vlan_id"] == 20


def test_migration_adds_vlan_columns(tmp_path):
    url = f"sqlite:///{tmp_path / 'm.db'}"
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=BACKEND,
        env={**os.environ, "DATABASE_URL": url},
        check=True,
    )
    insp = inspect(create_engine(url))
    assert {c["name"] for c in insp.get_columns("vlans")} >= {"vid", "covered", "device_count"}
    assert "vlan_id" in {c["name"] for c in insp.get_columns("devices")}
    assert "listen_only" in {c["name"] for c in insp.get_columns("family_settings")}
