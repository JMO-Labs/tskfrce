from datetime import UTC, datetime, timedelta

from app.core.config import settings
from app.models.inbox import Notification
from app.models.lock import Device, DeviceGroup, DeviceHintRejection, Override

URL = "/api/v1/internal/devices/seen"


def tok():
    return {"X-Internal-Token": settings.INTERNAL_TOKEN}


def _now():
    return datetime.now(UTC).replace(tzinfo=None)


def _old(db, kid, **kw):
    d = Device(
        mac="aa:00:00:00:00:01",
        name="Timmy's iPad",
        status="assigned",
        first_seen=_now() - timedelta(days=9),
        last_seen=_now() - timedelta(hours=2),
        **kw,
    )
    d.owners = [kid]
    db.add(d)
    db.commit()
    return d


def seen(client, mac="02:00:00:00:00:99", **kw):
    body = {"mac": mac, "ip": "10.0.0.9", "hostname": "iPhone", **kw}
    r = client.post(URL, json=body, headers=tok())
    assert r.status_code == 200, r.text
    return r.json()["id"]


def test_seen_hints_and_notifies(client, db, parent, kid):
    old = _old(db, kid, mdns_name="Bobbys-iPad")
    g = DeviceGroup(name="Tablets")
    old.groups = [g]
    db.add(Override(device_id=old.id, action="lock", source="manual", created_at=_now()))
    db.commit()
    did = seen(client, mdns_name="bobbys-ipad")
    db.expire_all()
    d = db.get(Device, did)
    assert d.status == "assigned" and d.owners == [kid] and d.groups == [g]
    assert (d.hint_of_id, d.hint_reason) == (old.id, "name")
    assert db.query(Override).filter_by(device_id=did, action="lock").count() == 1
    n = db.query(Notification).filter_by(kind="device_hint").one()
    assert n.user_id == parent.id and n.device_id == did
    assert n.title == "Timmy's iPad came back with a new address"
    assert n.body == "We gave it Timmy's rules. Not the same device? Undo."


def test_expired_lock_not_copied(client, db, kid):
    old = _old(db, kid, mdns_name="x")
    db.add(
        Override(
            device_id=old.id, action="lock", source="manual",
            expires_at=_now() - timedelta(minutes=1), created_at=_now(),
        )
    )  # fmt: skip
    db.commit()
    did = seen(client, mdns_name="x")
    assert db.query(Override).filter_by(device_id=did).count() == 0


def test_no_match_no_hint(client, db, kid):
    _old(db, kid, mdns_name="a")
    did = seen(client, mdns_name="b")
    assert db.get(Device, did).status == "unassigned"
    assert db.query(Notification).filter_by(kind="device_hint").count() == 0


def test_late_signal_hints(client, db, kid):
    _old(db, kid, mdns_name="Bobbys-iPad")
    did = seen(client)
    assert db.get(Device, did).status == "unassigned"
    seen(client, mdns_name="Bobbys-iPad")
    db.expire_all()
    d = db.get(Device, did)
    assert d.status == "assigned" and d.mdns_name == "Bobbys-iPad" and d.hint_reason == "name"


def test_signal_not_erased_by_none(client, db, kid):
    did = seen(client, mdns_name="x", model="m", dhcp_fp="1")
    seen(client)
    d = db.get(Device, did)
    assert (d.mdns_name, d.model, d.dhcp_fp) == ("x", "m", "1")


def test_guest_and_assigned_never_hinted(client, db, kid):
    _old(db, kid, mdns_name="x")
    did = seen(client)
    d = db.get(Device, did)
    d.status = "guest"
    db.commit()
    seen(client, mdns_name="x")
    db.expire_all()
    assert db.get(Device, did).hint_of_id is None and db.get(Device, did).status == "guest"
    d.status = "assigned"
    db.commit()
    seen(client, mdns_name="x", model="m")
    db.expire_all()
    assert db.get(Device, did).hint_of_id is None and db.get(Device, did).owners == []


def test_unchanged_signal_does_not_retry(client, db, kid):
    did = seen(client, mdns_name="x")  # no candidate yet
    _old(db, kid, mdns_name="x")
    seen(client, mdns_name="x")  # same signal: no re-evaluation
    assert db.get(Device, did).status == "unassigned"


def test_undo_and_404(client, db, parent_headers, kid):
    old = _old(db, kid, mdns_name="x")
    did = seen(client, mdns_name="x")
    r = client.post(f"/api/v1/devices/{did}/hint/undo", headers=parent_headers)
    assert r.status_code == 200
    assert r.json()["hint_of_id"] is None and r.json()["status"] == "unassigned"
    db.expire_all()
    d = db.get(Device, did)
    assert d.owners == [] and d.groups == [] and d.hint_reason is None
    assert db.get(DeviceHintRejection, (did, old.id)) is not None
    r = client.post(f"/api/v1/devices/{did}/hint/undo", headers=parent_headers)
    assert r.status_code == 404
    # rejected candidate is not offered again
    seen(client, mdns_name="x", model="m")
    db.expire_all()
    assert db.get(Device, did).hint_of_id is None


def test_undo_requires_parent_and_device(client, db, kid_headers, parent_headers):
    assert client.post("/api/v1/devices/1/hint/undo", headers=kid_headers).status_code == 403
    assert client.post("/api/v1/devices/999/hint/undo", headers=parent_headers).status_code == 404


def test_device_out_fields(client, db, parent_headers):
    seen(client, mdns_name="x", model="iPad1,1")
    d = client.get("/api/v1/devices", headers=parent_headers).json()[0]
    assert d["mdns_name"] == "x" and d["model"] == "iPad1,1"
    assert d["random_mac"] is True and d["hint_of_id"] is None and d["hint_reason"] is None


def test_hinted_device_gets_one_notice(client, db, parent, kid):
    _old(db, kid, mdns_name="x")
    did = seen(client, mdns_name="x")
    kinds = [n.kind for n in db.query(Notification).all()]
    assert "device_hint" in kinds and "new_device" not in kinds


def test_undo_removes_copied_lock(client, db, parent_headers, kid):
    old = _old(db, kid, mdns_name="x")
    db.add(Override(device_id=old.id, action="lock", source="manual", created_at=_now()))
    db.commit()
    did = seen(client, mdns_name="x")
    assert db.query(Override).filter_by(device_id=did).count() == 1
    client.post(f"/api/v1/devices/{did}/hint/undo", headers=parent_headers)
    db.expire_all()
    assert db.query(Override).filter_by(device_id=did).count() == 0


def test_strict_mode_hint_never_unblocks(client, db, kid):
    from app.models.family import get_family

    get_family(db).new_devices_blocked = True
    _old(db, kid, mdns_name="x")  # kid has no chores today, so the old device is online
    did = seen(client, mdns_name="x")
    d = db.get(Device, did)
    assert d.status == "unassigned" and d.hint_of_id is None
