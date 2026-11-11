"""Per-kid day facts for the Today cards: allowed windows, online minutes, lock reason."""

from datetime import UTC, datetime

from app.models.chores import ChoreRun
from app.models.device_activity import DevicePresence
from app.models.family import get_family
from app.models.lock import Device
from app.models.user import UserRole
from app.services import today_kid

from tests.conftest import _headers, _make_user
from tests.factories import make_rule, make_run

# 2026-10-20 is a Tuesday; family tz is UTC in tests
NOW = datetime(2026, 10, 20, 16, 0, tzinfo=UTC)


def _dev(db, kid, mac="aa:bb:cc:dd:ee:01"):
    d = Device(mac=mac, name="Tablet", status="assigned")
    d.owners = [kid]
    db.add(d)
    db.commit()
    return d


def _slot(db, dev, hh, mm, locked=False):
    db.add(DevicePresence(device_id=dev.id, slot=datetime(2026, 10, 20, hh, mm), locked=locked))
    db.commit()


def _kid(db):
    get_family(db).timezone = "UTC"
    db.commit()
    return _make_user(db, "leo", UserRole.KID)


def test_windows_clip_to_timeline_and_sum(db):
    kid = _kid(db)
    make_rule(db, kid_ids=[kid.id], times=(("06:00", "08:00"), ("15:00", "23:00")))
    out = today_kid.day_facts(db, kid, [], NOW)
    assert out["allowed"] == [[420, 480], [900, 1260]]
    assert out["allowed_minutes"] == 60 + 360


def test_no_rules_means_whole_day_allowed(db):
    kid = _kid(db)
    out = today_kid.day_facts(db, kid, [], NOW)
    assert out["allowed"] == [[420, 1260]]
    assert out["allowed_minutes"] == 840


def test_online_minutes_count_slots_once_inside_windows(db):
    kid = _kid(db)
    make_rule(db, kid_ids=[kid.id], times=(("15:00", "17:00"),))
    a, b = _dev(db, kid), _dev(db, kid, "aa:bb:cc:dd:ee:02")
    _slot(db, a, 15, 0)
    _slot(db, b, 15, 0)  # same slot, other device: counted once
    _slot(db, a, 15, 10)
    _slot(db, a, 15, 20, locked=True)  # locked slot is not online
    _slot(db, a, 12, 0)  # outside the allowed window
    out = today_kid.day_facts(db, kid, [a, b], NOW)
    assert out["online_minutes"] == 20


def test_lock_reason_hours_and_open(db):
    kid = _kid(db)
    make_rule(db, kid_ids=[kid.id], times=(("17:00", "18:00"),))
    d = _dev(db, kid)
    assert today_kid.day_facts(db, kid, [d], NOW)["lock_reason"] == "hours"
    inside = datetime(2026, 10, 20, 17, 30, tzinfo=UTC)
    assert today_kid.day_facts(db, kid, [d], inside)["lock_reason"] is None


def test_lock_reason_none_without_devices(db):
    kid = _kid(db)
    assert today_kid.day_facts(db, kid, [], NOW)["lock_reason"] is None


def test_chore_completions_listed_with_times(db):
    kid = _kid(db)
    parent = _make_user(db, "mum", UserRole.PARENT)
    r = make_run(db, parent, kid, status="done", approved=True, title="Dishes")
    r.completed_at = datetime(2026, 10, 20, 15, 30)
    db.commit()
    make_run(db, parent, kid, status="todo", title="Bins")
    runs = db.query(ChoreRun).all()
    out = today_kid.day_facts(db, kid, [], NOW, runs=runs)
    assert out["completions"] == [{"title": "Dishes", "at": "2026-10-20T15:30:00Z"}]


def test_api_exposes_fields(client, db, parent_headers):
    _kid(db)
    kid = _make_user(db, "maya", UserRole.KID)
    _headers(db, kid)
    r = client.get("/api/v1/today", headers=parent_headers)
    k = r.json()["kids"][0]
    for f in ("online_minutes", "allowed_minutes", "allowed", "lock_reason", "completions"):
        assert f in k
