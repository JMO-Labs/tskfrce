from datetime import UTC, datetime

from app.models import device_activity as da
from app.models import inbox
from app.models.device_activity import DeviceEvent
from app.models.inbox import Notification
from app.models.lock import Device
from app.services import inbox as inbox_svc
from app.services import notify

NEW = {"identity_change", "workaround_try"}
NEW_INBOX = {"password_guess", "workaround_try"}


def test_kinds_registered():
    assert NEW <= set(da.KINDS)
    assert NEW <= set(da.ALERT_KINDS)
    assert NEW <= set(da.FILTERS["bypass"])
    assert NEW_INBOX <= set(inbox.KINDS)
    assert not (NEW_INBOX & inbox_svc.KID_KINDS)
    assert notify.KIND_EVENT["password_guess"] == "resisting"
    assert notify.KIND_EVENT["workaround_try"] == "workaround"
    assert notify.EVENTS["workaround"] == "Tried a workaround"
    assert "workaround" in notify.DEFAULT_EVENTS and "workaround" not in notify.SECURITY


def test_db_accepts_new_kinds(db, kid):
    d = Device(mac="aa:bb:cc:dd:ee:09", name="Pad", status="assigned")
    db.add(d)
    db.flush()
    now = datetime.now(UTC).replace(tzinfo=None)
    for k in sorted(NEW):
        db.add(DeviceEvent(device_id=d.id, kind=k, at=now))
    for k in sorted(NEW_INBOX):
        db.add(Notification(user_id=kid.id, kind=k, title="t"))
    db.commit()
    assert db.query(DeviceEvent).count() == 2
    assert db.query(Notification).count() == 2
