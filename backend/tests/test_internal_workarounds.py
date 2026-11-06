from datetime import UTC, datetime, timedelta

from app.core.config import settings
from app.lock.overrides import set_override
from app.models.device_activity import DeviceEvent
from app.models.inbox import Notification
from app.models.lock import Device

URL = "/api/v1/internal/devices/workarounds"
MAC = "aa:bb:cc:dd:ee:01"


def tok():
    return {"X-Internal-Token": settings.INTERNAL_TOKEN}


def _now():
    return datetime.now(UTC).replace(tzinfo=None)


def _paused(db, parent, locked=True):
    d = Device(mac=MAC, name="Pad", status="assigned", blocked_since=_now() - timedelta(minutes=5))
    db.add(d)
    db.commit()
    if locked:
        set_override(db, [d.id], "lock", 30, parent.id)
        db.commit()
    return d


def _post(client, cats, mac=MAC):
    return client.post(URL, json={"found": {mac: cats}}, headers=tok())


def _counts(db):
    db.expire_all()
    ev = db.query(DeviceEvent).filter_by(kind="workaround_try").count()
    return ev, db.query(Notification).filter_by(kind="workaround_try").count()


def test_alerts_once(client, db, parent):
    _paused(db, parent)
    assert _post(client, ["vpn"]).json() == {"logged": 1}
    assert _counts(db) == (1, 1)
    n = db.query(Notification).filter_by(kind="workaround_try").one()
    assert n.title == "Pad tried a VPN"
    assert n.body == "It didn't work — the pause is still on."


def test_once_per_pause(client, db, parent):
    _paused(db, parent)
    _post(client, ["vpn"])
    assert _post(client, ["vpn"]).json() == {"logged": 0}
    assert _counts(db) == (1, 1)


def test_new_pause_alerts_again(client, db, parent):
    d = _paused(db, parent)
    _post(client, ["vpn"])
    d.blocked_since = _now() + timedelta(seconds=5)
    db.commit()
    assert _post(client, ["vpn"]).json() == {"logged": 1}
    assert _counts(db) == (2, 2)


def test_two_categories_two_alerts(client, db, parent):
    _paused(db, parent)
    assert _post(client, ["vpn", "tor", "vpn"]).json() == {"logged": 2}
    assert _counts(db) == (2, 2)


def test_unpaused_device_ignored(client, db, parent):
    db.add(Device(mac=MAC, name="Pad", status="assigned"))
    db.commit()
    assert _post(client, ["vpn"]).json() == {"logged": 0}
    assert _counts(db) == (0, 0)


def test_open_now_ignored(client, db, parent):
    _paused(db, parent, locked=False)  # blocked_since stale, nothing locks it
    assert _post(client, ["vpn"]).json() == {"logged": 0}
    assert _counts(db) == (0, 0)


def test_bad_category_422(client, db):
    assert _post(client, ["dns"]).status_code == 422
    assert _post(client, ["vpn"], mac="nope").status_code == 422


def test_requires_token(client, db):
    assert client.post(URL, json={"found": {}}).status_code == 403
