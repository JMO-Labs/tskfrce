"""Auto boost: who counts as quiet, per-kid isolation, and the DST day."""

from datetime import UTC, date, datetime, timedelta

import pytest
from app.models.family import get_family
from app.models.happy_hour import HappyHour
from app.models.user import UserRole
from app.services import happy_hour, notify_jobs

from tests.conftest import _make_user
from tests.factories import make_run
from tests.test_boost import AT16, WED, _auto, _quiet, _tick


@pytest.fixture(autouse=True)
def _utc(db):
    fam = get_family(db)
    fam.timezone, fam.last_reset_date = "UTC", None
    db.commit()


# (g) the last 2 days that had runs, looking back up to 7 days


def test_days_without_runs_are_skipped(db, parent, kid):
    _quiet(db, parent, kid, days=(1, 4))  # 2 and 3 had nothing assigned
    _tick(db, AT16)
    assert [h.kid_ids for h in _auto(db)] == [[kid.id]]


def test_only_the_last_two_run_days_count(db, parent, kid):
    _quiet(db, parent, kid, days=(1, 2))
    make_run(db, parent, kid, day=WED - timedelta(days=3), title="old", status="done")
    _tick(db, AT16)
    assert len(_auto(db)) == 1


def test_a_done_day_among_the_last_two_is_not_quiet(db, parent, kid):
    _quiet(db, parent, kid, days=(1, 5))
    make_run(db, parent, kid, day=WED - timedelta(days=1), title="did", status="done")
    _tick(db, AT16)
    assert _auto(db) == []


def test_look_back_is_seven_days(db, parent, kid):
    _quiet(db, parent, kid, days=(1, 8))  # day 8 is out of range: only one run day
    _tick(db, AT16)
    assert _auto(db) == []
    _quiet(db, parent, kid, days=(7,))
    get_family(db).hh_auto_date = None
    _tick(db, AT16)
    assert len(_auto(db)) == 1


def test_one_run_day_is_not_quiet(db, parent, kid):
    _quiet(db, parent, kid, days=(3,))
    _tick(db, AT16)
    assert _auto(db) == []


# (h) anything sent in today means not quiet


@pytest.mark.parametrize("status", ["submitted", "done"])
def test_submitted_today_is_not_boosted(db, parent, kid, status):
    _quiet(db, parent, kid)
    make_run(db, parent, kid, day=WED, title="today", status=status)
    _tick(db, AT16)
    assert _auto(db) == []


def test_open_run_today_still_boosts(db, parent, kid):
    _quiet(db, parent, kid)
    make_run(db, parent, kid, day=WED, title="today")
    _tick(db, AT16)
    assert len(_auto(db)) == 1


# (i) one kid failing never undoes the date guard, the other kids or the other jobs


def test_one_kid_failing_does_not_stop_the_rest(db, parent, kid, monkeypatch, caplog):
    ana = _make_user(db, "ana", UserRole.KID)
    _quiet(db, parent, kid)
    for n in (1, 2):
        make_run(db, parent, ana, day=WED - timedelta(days=n), title=f"a{n}")
    real = happy_hour.start

    def flaky(db, **kw):
        hh = real(db, **kw)
        if kw["kid_ids"] == [kid.id]:
            raise RuntimeError("boom")  # after a half-write that must not stick
        return hh

    monkeypatch.setattr(happy_hour, "start", flaky)
    notify_jobs.tick(db, AT16)
    db.expire_all()
    assert [h.kid_ids for h in _auto(db)] == [[ana.id]]
    assert db.query(HappyHour).count() == 1
    assert get_family(db).hh_auto_date == WED
    assert "auto boost failed" in caplog.text


# (j) team runs only (the run_kids path)


def test_quiet_kid_with_only_team_runs(db, parent, kid):
    ana = _make_user(db, "ana", UserRole.KID)
    for n in (1, 2):
        make_run(
            db, parent, kids=[kid, ana], mode="team", day=WED - timedelta(days=n), title=f"t{n}"
        )
    _tick(db, AT16)
    assert sorted(h.kid_ids[0] for h in _auto(db)) == sorted([kid.id, ana.id])


def test_team_run_submitted_by_a_sibling_is_not_quiet(db, parent, kid):
    ana = _make_user(db, "ana", UserRole.KID)
    make_run(db, parent, kids=[kid, ana], mode="team", day=WED - timedelta(days=1), title="t1")
    make_run(
        db, parent, kids=[kid, ana], mode="team", day=WED - timedelta(days=2), status="submitted"
    )
    _tick(db, AT16)
    assert _auto(db) == []


# (k) DST: New York falls back on 2026-11-01 (EDT -4 until 02:00, then EST -5)

DST = date(2026, 11, 1)


def test_dst_day_trigger_is_16_local_est(db, parent, kid):
    get_family(db).timezone = "America/New_York"
    db.commit()
    for n in (1, 2):
        make_run(db, parent, kid, day=DST - timedelta(days=n), title=f"d{n}")
    _tick(db, datetime(2026, 11, 1, 20, 59, tzinfo=UTC))  # 15:59 EST (16:59 would be EDT)
    assert _auto(db) == []
    _tick(db, datetime(2026, 11, 1, 21, 0, tzinfo=UTC))  # 16:00 EST
    [hh] = _auto(db)
    assert hh.starts_at == datetime(2026, 11, 1, 21, 0)


@pytest.mark.parametrize(
    "earlier,capped",
    [
        (datetime(2026, 11, 1, 4, 0), True),  # 00:00 EDT: local midnight, same day
        (datetime(2026, 11, 1, 3, 59), False),  # 23:59 EDT on Oct 31
    ],
)
def test_dst_day_daily_cap_starts_at_local_midnight(db, parent, kid, earlier, capped):
    get_family(db).timezone = "America/New_York"
    db.commit()
    for n in (1, 2):
        make_run(db, parent, kid, day=DST - timedelta(days=n), title=f"d{n}")
    happy_hour.start(
        db, kid_ids=[kid.id], minutes=60, mult_x10=20, source="auto", by=None, now=earlier
    )
    db.commit()
    _tick(db, datetime(2026, 11, 1, 21, 0, tzinfo=UTC))
    assert len(_auto(db)) == (1 if capped else 2)
