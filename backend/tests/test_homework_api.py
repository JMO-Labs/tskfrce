"""Homework override API: device, kid and group targets."""

from datetime import UTC, datetime, timedelta

from app.lock.overrides import set_homework
from app.lock.state import desired_blocked
from app.models.lock import Device, DeviceGroup, Override

from tests.factories import make_rule


def mk(db, kid=None, mac="aa:bb:cc:dd:ee:01", exempt=False):
    """A kid's device: exempt ones are online, the rest paused by a manual lock."""
    d = Device(mac=mac, name=f"Dev {mac[-2:]}", status="assigned", exempt=exempt)
    d.owners = [kid] if kid else []
    db.add(d)
    db.commit()
    if not exempt:
        db.add(Override(device_id=d.id, action="lock", source="manual"))
        db.commit()
    return d


def manual(db, device_id, action="homework"):
    q = db.query(Override).filter_by(device_id=device_id, source="manual")
    return q.filter_by(action=action).all() if action else q.all()


def _soon(minutes):
    return datetime.now(UTC).replace(tzinfo=None) + timedelta(minutes=minutes)


def _close(at, want):
    return abs(at - want) < timedelta(seconds=5)


def _post(client, headers, kind, tid, **body):
    body.setdefault("action", "homework")
    return client.post(f"/api/v1/{kind}/{tid}/override", json=body, headers=headers)


def test_device_paused_gets_homework_for_60_minutes(client, db, kid, parent_headers):
    d = mk(db, kid)
    r = _post(client, parent_headers, "devices", d.id)
    assert r.status_code == 200, r.text
    assert r.json()["ok"] is True
    [o] = manual(db, d.id)
    assert o.action == "homework"
    assert _close(o.expires_at, _soon(60))
    assert r.json()["expires_at"].endswith("Z")  # the frontend toast shows the end time


def test_device_online_is_409(client, db, kid, parent_headers):
    d = mk(db, kid, exempt=True)
    r = _post(client, parent_headers, "devices", d.id)
    assert r.status_code == 409
    assert r.json()["detail"] == f"{d.name} is already online."
    assert manual(db, d.id) == []


def test_bedtime_caps_expiry(db, kid, parent):
    now = datetime(2026, 10, 20, 15, 0, tzinfo=UTC)
    make_rule(db, kid_ids=[kid.id], times=(("00:00", "15:20"),))
    d = mk(db, kid)
    assert [o.device_id for o in set_homework(db, [d], None, parent.id, now)] == [d.id]
    db.commit()
    [o] = manual(db, d.id)
    assert o.expires_at == datetime(2026, 10, 20, 15, 20)


def test_second_call_replaces_timer(client, db, kid, parent_headers):
    d = mk(db, kid)
    _post(client, parent_headers, "devices", d.id)
    r = _post(client, parent_headers, "devices", d.id, minutes=30)
    assert r.status_code == 200
    [o] = manual(db, d.id)
    assert _close(o.expires_at, _soon(30))


def test_kid_applies_to_paused_devices_only(client, db, kid, parent_headers):
    paused = mk(db, kid)
    online = mk(db, kid, mac="aa:bb:cc:dd:ee:02", exempt=True)
    r = _post(client, parent_headers, "kids", kid.id)
    assert r.status_code == 200, r.text
    assert r.json()["devices"] == 1
    assert [o.action for o in manual(db, paused.id)] == ["homework"]
    assert manual(db, online.id) == []


def test_kid_none_paused_is_409(client, db, kid, parent_headers):
    mk(db, kid, exempt=True)
    r = _post(client, parent_headers, "kids", kid.id)
    assert r.status_code == 409
    assert r.json()["detail"] == "None of Timmy's devices are paused."


def _group(db, *devices):
    g = DeviceGroup(name="Tablets")
    g.devices = list(devices)
    db.add(g)
    db.commit()
    return g


def test_group_applies_to_paused_only(client, db, kid, parent_headers):
    online = mk(db, kid, mac="aa:bb:cc:dd:ee:02", exempt=True)
    g = _group(db, mk(db, kid), online)
    r = _post(client, parent_headers, "groups", g.id)
    assert r.status_code == 200, r.text
    assert r.json()["devices"] == 1
    assert manual(db, online.id) == []


def test_group_none_paused_is_409(client, db, kid, parent_headers):
    g = _group(db, mk(db, kid, exempt=True))
    r = _post(client, parent_headers, "groups", g.id)
    assert r.status_code == 409
    assert r.json()["detail"] == "None of Tablets's devices are paused."


def test_lock_still_fans_out_to_every_device(client, db, kid, parent_headers):
    a, b = mk(db, kid), mk(db, kid, mac="aa:bb:cc:dd:ee:02", exempt=True)
    r = _post(client, parent_headers, "kids", kid.id, action="lock")
    assert r.status_code == 200 and r.json()["devices"] == 2
    assert len(manual(db, a.id, "lock")) == len(manual(db, b.id, "lock")) == 1


def test_kid_token_cannot_set_homework(client, db, kid, kid_headers):
    d = mk(db, kid)
    assert _post(client, kid_headers, "devices", d.id).status_code in (401, 403)


def test_delete_ends_homework(client, db, kid, parent_headers):
    d = mk(db, kid)
    _post(client, parent_headers, "devices", d.id)
    r = client.delete(f"/api/v1/devices/{d.id}/override", headers=parent_headers)
    assert r.status_code == 200
    assert manual(db, d.id, None) == []


def test_homework_keeps_manual_lock(client, db, kid, parent_headers):
    """Homework on a locked device must not lift the lock underneath it."""
    make_rule(db, kid_ids=[kid.id])  # all-day hours: only the lock pauses it
    d = mk(db, kid, exempt=True)
    d.exempt = False
    _post(client, parent_headers, "devices", d.id, action="lock")
    r = _post(client, parent_headers, "devices", d.id)
    assert r.status_code == 200, r.text
    assert sorted(o.action for o in manual(db, d.id, None)) == ["homework", "lock"]
    assert d.mac in desired_blocked(db, datetime.now(UTC))
