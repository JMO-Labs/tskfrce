"""Turnkey defaults: wizard chores start tomorrow, screen time on, quieter alerts."""

from datetime import timedelta

from app.core.config import settings
from app.core.crypto import seal
from app.models.chores import ChoreRun
from app.models.family import get_family
from app.models.inbox import Notification
from app.models.notify import NotifyPlace
from app.services import chores as svc
from app.services import notify

from tests.conftest import _make_user
from tests.factories import DAY, api_chore
from tests.test_setup import BODY


def _kid(db):
    from app.models.user import UserRole

    return _make_user(db, "leo", UserRole.KID)


def test_wizard_chores_start_tomorrow(client, db, parent_headers):
    get_family(db).last_reset_date = DAY
    get_family(db).setup_step = 5
    db.commit()
    api_chore(client, parent_headers, [_kid(db)])
    assert db.query(ChoreRun).count() == 0
    tomorrow = svc.today(db) + timedelta(days=1)
    svc.run_reset(db, tomorrow)  # the normal reset path
    db.commit()
    assert [r.day for r in db.query(ChoreRun)] == [tomorrow]


def test_chores_after_setup_start_today(client, db, parent_headers):
    get_family(db).last_reset_date = DAY
    db.commit()
    api_chore(client, parent_headers, [_kid(db)])
    assert [r.day for r in db.query(ChoreRun)] == [svc.today(db)]


def test_new_family_screen_time_on(client, db):
    assert client.post("/api/v1/setup", json=BODY).status_code == 201
    fam = get_family(db)
    assert fam.points_unlock_early is True
    assert fam.screen_auto_approve is False


def test_default_events():
    assert notify.DEFAULT_EVENTS == (
        "chore_ok",
        "kid_note",
        "reward_request",
        "resisting",
        "box_offline",
        "workaround",
        "summary",
    )


def test_no_new_device_bell_during_setup(client, db, parent):
    from app.models.lock import Device

    get_family(db).setup_step = 5
    db.commit()
    h = {"X-Internal-Token": settings.INTERNAL_TOKEN}
    r = client.post(
        "/api/v1/internal/devices/seen",
        json={"mac": "aa:bb:cc:dd:ee:77", "hostname": "Newbie"},
        headers=h,
    )
    assert r.status_code == 200
    assert db.query(Device).filter_by(mac="aa:bb:cc:dd:ee:77").count() == 1
    assert db.query(Notification).filter_by(kind="new_device").count() == 0


def test_existing_place_events_unchanged(db):
    old = "chore_ok,new_device,resisting"
    db.add(NotifyPlace(name="P", url_enc=seal("json://x"), url_mask="m", events=old))
    db.commit()
    assert db.query(NotifyPlace).one().events == old
