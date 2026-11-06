from app.core.config import settings
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


def test_fingerprint_only_logs(client, db, parent):
    _setup(db, parent)
    _seen(client, model="iPad", dhcp_fp="1,3,6")
    _seen(client, model="iPad", dhcp_fp="1,121,3")
    ev, nt = _counts(db)
    assert [e.detail for e in ev] == ["fingerprint"] and nt == []


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
