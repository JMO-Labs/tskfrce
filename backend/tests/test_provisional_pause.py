"""A new private device starts paused when a paused kid device just went silent (tskfrce#117)."""

from datetime import timedelta

from app.models.lock import Device, Override
from tests.test_device_relink import NEW_MAC, _now, _old, seen

HW = "a8:bb:cc:dd:ee:03"


def pause(db, dev):
    db.add(Override(device_id=dev.id, action="lock", source="manual", created_at=_now()))
    db.commit()


def test_provisional_pause_set(client, db, kid):
    old = _old(db, kid, silent=timedelta(seconds=10))
    pause(db, old)
    d = db.get(Device, seen(client))
    assert d.status == "unassigned" and d.held and d.held_provisional


def test_lifted_on_conflict(client, db, kid):
    old = _old(db, kid, silent=timedelta(seconds=10), vendor="Apple")
    pause(db, old)
    seen(client)
    seen(client, vendor="Samsung")
    db.expire_all()
    d = db.query(Device).filter_by(mac=NEW_MAC).one()
    assert not d.held and not d.held_provisional


def test_lifted_when_old_reappears(client, db, kid):
    old = _old(db, kid, silent=timedelta(seconds=10))
    pause(db, old)
    seen(client)
    old.last_seen = _now()
    db.commit()
    seen(client)
    db.expire_all()
    d = db.query(Device).filter_by(mac=NEW_MAC).one()
    assert not d.held and not d.held_provisional


def test_replaced_on_link(client, db, kid):
    old = _old(db, kid, silent=timedelta(seconds=10))
    pause(db, old)
    did = seen(client)
    old.last_seen = _now() - timedelta(seconds=50)
    db.commit()
    seen(client)
    db.expire_all()
    d = db.get(Device, did)
    assert d.status == "assigned" and d.hint_reason == "relink"
    assert not d.held and not d.held_provisional


def test_never_when_nothing_paused(client, db, kid):
    _old(db, kid, silent=timedelta(seconds=10))
    d = db.get(Device, seen(client))
    assert not d.held and not d.held_provisional


def test_never_for_hardware_mac(client, db, kid):
    old = _old(db, kid, silent=timedelta(seconds=10))
    pause(db, old)
    d = db.get(Device, seen(client, mac=HW))
    assert not d.held and not d.held_provisional


def test_expires_after_window(client, db, kid):
    old = _old(db, kid, silent=timedelta(seconds=10))
    pause(db, old)
    did = seen(client)
    d = db.get(Device, did)
    d.first_seen = _now() - timedelta(minutes=11)
    old.last_seen = d.first_seen - timedelta(seconds=5)
    db.commit()
    seen(client)
    db.expire_all()
    assert not db.get(Device, did).held
