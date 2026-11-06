from datetime import timedelta

import pytest
from app.core.config import settings
from app.lock import identity
from app.models.device_activity import DeviceEvent
from app.models.inbox import Notification
from app.models.lock import Device

SEEN = "/api/v1/internal/devices/seen"
MAC = "aa:bb:cc:dd:ee:07"


def _seen(client, **kw):
    r = client.post(
        SEEN,
        json={"mac": MAC, "ip": "192.168.1.40", **kw},
        headers={"X-Internal-Token": settings.INTERNAL_TOKEN},
    )
    assert r.status_code == 200


def _setup(db, parent, status="assigned"):
    db.add(Device(mac=MAC, name="Pad", status=status))
    db.commit()


def _counts(db):
    db.expire_all()
    ev = db.query(DeviceEvent).filter(DeviceEvent.kind == "identity_change").all()
    nt = db.query(Notification).filter(Notification.kind == "device_bypass").all()
    return ev, nt


def test_model_change_alerts(client, db, parent):
    _setup(db, parent)
    _seen(client, model="iPad")
    _seen(client, model="MacBookPro18,1")
    ev, nt = _counts(db)
    assert len(ev) == 1 and ev[0].detail == "iPad → MacBookPro18,1"
    assert len(nt) == 1 and nt[0].title == "Pad may be a different device"


def test_first_model_no_alert(client, db, parent):
    _setup(db, parent)
    _seen(client)
    _seen(client, model="iPad")
    assert _counts(db) == ([], [])


def test_fingerprint_only_ignored(client, db, parent):
    _setup(db, parent)
    _seen(client, model="iPad", dhcp_fp="1,3,6")
    _seen(client, model="iPad", dhcp_fp="1,121,3")
    assert _counts(db) == ([], [])


def test_unassigned_ignored(client, db, parent):
    _setup(db, parent, status="unassigned")
    _seen(client, model="iPad")
    _seen(client, model="MacBookPro18,1")
    assert _counts(db) == ([], [])


def test_same_report_twice_once(client, db, parent):
    _setup(db, parent)
    _seen(client, model="iPad")
    _seen(client, model="MacBookPro18,1")
    _seen(client, model="MacBookPro18,1")
    ev, nt = _counts(db)
    assert len(ev) == 1 and len(nt) == 1


def test_flip_flop_notifies_once_per_day(client, db, parent):
    _setup(db, parent)
    _seen(client, model="iPad")
    _seen(client, model="MacBookPro18,1")
    _seen(client, model="iPad")
    ev, nt = _counts(db)
    assert len(ev) == 2 and len(nt) == 1
    for e in ev:
        e.at -= timedelta(hours=25)
    db.commit()
    _seen(client, model="Pixel 8")
    ev, nt = _counts(db)
    assert len(ev) == 3 and len(nt) == 2


@pytest.mark.parametrize(
    "bad",
    [
        "Pad\nTap http://x.co",
        "http://evil.example/x?a=<b>",
        "A" * 60,
        "iPad. Fix it at evil.co",
        "MacBookPro18,1",
    ],
)
def test_model_never_echoed(client, db, parent, bad):
    _setup(db, parent)
    _seen(client, model="iPad")
    _seen(client, model=bad)
    ev, nt = _counts(db)
    assert len(nt) == 1 and nt[0].body == identity.BODY and bad not in nt[0].body
    assert len(ev[0].detail) <= 120


def test_changes_under_24h_apart_still_realert(client, db, parent):
    _setup(db, parent)
    _seen(client, model="iPad")
    _seen(client, model="Pixel 8")  # t=0: alert
    for model in ("iPad", "Pixel 8"):  # +20 h, +40 h
        ev, _ = _counts(db)
        for e in ev:
            e.at -= timedelta(hours=20)
        db.commit()
        _seen(client, model=model)
    ev, nt = _counts(db)
    assert len(ev) == 3 and len(nt) == 2  # +20 h quiet, +40 h alerts again
