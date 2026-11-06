"""Auto boost (quiet kid -> Happy Hour next afternoon) and the weekly surprise."""

import random
from datetime import UTC, date, datetime, timedelta

import pytest
from app.models.family import get_family
from app.models.happy_hour import HappyHour
from app.models.inbox import Notification
from app.models.user import UserRole
from app.services import boost, happy_hour, notify, notify_jobs

from tests.conftest import _make_user
from tests.factories import make_run
from tests.test_notify_core import _place

WED = date(2026, 11, 4)  # a Wednesday
AT16 = datetime(2026, 11, 4, 16, 0, tzinfo=UTC)
COPY = "Timmy's had a quiet couple of days, so we started a Happy Hour for them."


@pytest.fixture(autouse=True)
def _utc(db):
    fam = get_family(db)
    fam.timezone, fam.last_reset_date = "UTC", None
    db.commit()


def _quiet(db, parent, kid, days=(1, 2)):
    for n in days:
        make_run(db, parent, kid, day=WED - timedelta(days=n), title=f"c{n}")


def _auto(db):
    return db.query(HappyHour).filter_by(source="auto").order_by(HappyHour.id).all()


def _tick(db, now):
    boost.auto_boost(db, now)
    db.commit()


# --- auto boost ---


def test_quiet_kid_gets_happy_hour_at_16_and_parents_hear(db, parent, kid, pings):
    _place(db, events=("boost",))
    _quiet(db, parent, kid)
    _tick(db, AT16 - timedelta(minutes=1))
    assert _auto(db) == []
    _tick(db, AT16)
    [hh] = _auto(db)
    assert hh.kid_ids == [kid.id] and hh.mult_x10 == 20 and hh.created_by is None
    assert hh.starts_at == datetime(2026, 11, 4, 16, 0)
    assert hh.ends_at == datetime(2026, 11, 4, 17, 0)
    note = db.query(Notification).filter_by(kind="boost", user_id=parent.id).one()
    assert note.title == COPY
    assert [p[1] for p in pings] == [COPY]


def test_local_time_zone(db, parent, kid):
    get_family(db).timezone = "America/New_York"  # EST in November: 16:00 = 21:00 UTC
    db.commit()
    _quiet(db, parent, kid)
    _tick(db, datetime(2026, 11, 4, 20, 59, tzinfo=UTC))
    assert _auto(db) == []
    _tick(db, datetime(2026, 11, 4, 21, 0, tzinfo=UTC))
    assert len(_auto(db)) == 1


def test_tick_twice_in_a_minute_makes_one(db, parent, kid):
    """Review Focus 3."""
    _quiet(db, parent, kid)
    notify_jobs.tick(db, AT16)
    notify_jobs.tick(db, AT16 + timedelta(seconds=30))
    assert len(_auto(db)) == 1


def test_nothing_assigned_is_not_quiet(db, parent, kid):
    """Review Focus 4: a kid with nothing assigned is never boosted."""
    _tick(db, AT16)
    assert _auto(db) == []


@pytest.mark.parametrize("status", ["submitted", "done"])
def test_any_submit_is_not_quiet(db, parent, kid, status):
    _quiet(db, parent, kid)
    make_run(db, parent, kid, day=WED - timedelta(days=1), title="did", status=status)
    _tick(db, AT16)
    assert _auto(db) == []


def test_skipped_runs_do_not_count_as_assigned(db, parent, kid):
    _quiet(db, parent, kid, days=(1,))
    make_run(db, parent, kid, day=WED - timedelta(days=2), status="skipped")
    _tick(db, AT16)
    assert _auto(db) == []


def test_only_the_quiet_kid(db, parent, kid):
    ana = _make_user(db, "ana", UserRole.KID)
    _quiet(db, parent, kid)
    make_run(db, parent, ana, day=WED - timedelta(days=1), title="a1", status="done")
    make_run(db, parent, ana, day=WED - timedelta(days=2), title="a2")
    _tick(db, AT16)
    assert [h.kid_ids for h in _auto(db)] == [[kid.id]]


def test_switch_off(db, parent, kid):
    get_family(db).hh_auto_boost = False
    _quiet(db, parent, kid)
    _tick(db, AT16)
    assert _auto(db) == []


def test_too_late_after_downtime_skips_the_day(db, parent, kid):
    _quiet(db, parent, kid)
    _tick(db, AT16 + timedelta(hours=2, minutes=1))
    assert _auto(db) == [] and get_family(db).hh_auto_date == WED


def _old_auto(db, kid, at):
    happy_hour.start(db, kid_ids=[kid.id], minutes=60, mult_x10=20, source="auto", by=None, now=at)
    db.commit()


def test_daily_cap(db, parent, kid):
    _quiet(db, parent, kid)
    _old_auto(db, kid, datetime(2026, 11, 4, 9, 0))
    _tick(db, AT16)
    assert len(_auto(db)) == 1


def test_weekly_cap(db, parent, kid):
    _quiet(db, parent, kid)
    for n in (3, 5):
        _old_auto(db, kid, datetime(2026, 11, 4, 16, 0) - timedelta(days=n))
    _tick(db, AT16)
    assert len(_auto(db)) == 2


def test_weekly_cap_rolls_after_seven_days(db, parent, kid):
    _quiet(db, parent, kid)
    for n in (3, 7):
        _old_auto(db, kid, datetime(2026, 11, 4, 16, 0) - timedelta(days=n))
    _tick(db, AT16)
    assert len(_auto(db)) == 3


def test_parent_happy_hour_does_not_use_up_the_cap(db, parent, kid):
    _quiet(db, parent, kid)
    happy_hour.start(
        db,
        kid_ids=[kid.id],
        minutes=60,
        mult_x10=20,
        source="parent",
        by=parent.id,
        now=datetime(2026, 11, 4, 9, 0),
    )
    _tick(db, AT16)
    assert len(_auto(db)) == 1


def test_boost_event_registered():
    assert notify.EVENTS["boost"] == "Auto Happy Hour started"
    assert "boost" in notify.DEFAULT_EVENTS and "boost" not in notify.SECURITY
    assert notify.KIND_EVENT["boost"] == "boost"


# --- weekly surprise ---

MON9 = datetime(2026, 11, 2, 9, 0, tzinfo=UTC)


def _sched(db):
    return db.query(HappyHour).filter_by(source="schedule").all()


def _surprise(db, now, seed=1):
    boost.weekly_surprise(db, now, random.Random(seed))
    db.commit()


def test_pick_slot_is_a_weekday_at_16_17_or_18():
    for seed in range(50):
        slot = boost.pick_slot(datetime(2026, 11, 2, 9, 0), random.Random(seed))
        assert slot.weekday() < 5 and slot.hour in (16, 17, 18) and slot.minute == 0
        assert date(2026, 11, 2) <= slot.date() <= date(2026, 11, 6)


def test_pick_slot_only_future_slots_this_week():
    for seed in range(20):
        slot = boost.pick_slot(datetime(2026, 11, 6, 17, 30), random.Random(seed))
        assert slot == datetime(2026, 11, 6, 18, 0)
    assert boost.pick_slot(datetime(2026, 11, 6, 18, 0), random.Random(1)) is None
    assert boost.pick_slot(datetime(2026, 11, 7, 9, 0), random.Random(1)) is None


def test_surprise_off_by_default(db, kid):
    for h in range(0, 24 * 7):
        _surprise(db, MON9 + timedelta(hours=h))
    assert _sched(db) == [] and get_family(db).hh_surprise_at is None


def test_surprise_fires_once_a_week_for_all_kids(db, kid):
    fam = get_family(db)
    fam.hh_weekly_surprise, fam.hh_default_mult_x10 = True, 30
    db.commit()
    _surprise(db, MON9)
    planned = get_family(db).hh_surprise_at
    assert planned is not None and planned.hour in (16, 17, 18)
    for m in range(0, 60 * 24 * 7 - 9 * 60, 15):  # every 15 min to the end of Sunday
        _surprise(db, MON9 + timedelta(minutes=m))
    [hh] = _sched(db)
    assert hh.starts_at == planned and hh.kid_ids is None and hh.mult_x10 == 30
    assert hh.ends_at == planned + timedelta(minutes=60)
    _surprise(db, datetime(2026, 11, 9, 9, 0, tzinfo=UTC))  # next Monday: plans again
    assert get_family(db).hh_surprise_at > planned


def test_surprise_switched_off_after_planning_does_not_fire(db, kid):
    get_family(db).hh_weekly_surprise = True
    db.commit()
    _surprise(db, MON9)
    get_family(db).hh_weekly_surprise = False
    db.commit()
    for d in range(5):
        _surprise(db, MON9 + timedelta(days=d, hours=10))
    assert _sched(db) == []


def test_surprise_turned_on_saturday_waits_for_next_week(db, kid):
    get_family(db).hh_weekly_surprise = True
    db.commit()
    _surprise(db, datetime(2026, 11, 7, 9, 0, tzinfo=UTC))
    _surprise(db, datetime(2026, 11, 8, 20, 0, tzinfo=UTC))
    assert get_family(db).hh_surprise_at is None and _sched(db) == []
    _surprise(db, datetime(2026, 11, 9, 9, 0, tzinfo=UTC))
    assert get_family(db).hh_surprise_at is not None


def test_surprise_missed_by_downtime_is_dropped(db, kid):
    get_family(db).hh_weekly_surprise = True
    db.commit()
    _surprise(db, MON9)
    planned = get_family(db).hh_surprise_at.replace(tzinfo=UTC)
    _surprise(db, planned + timedelta(hours=3))
    assert _sched(db) == [] and get_family(db).hh_surprise_at is None
