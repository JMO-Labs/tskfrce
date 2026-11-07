"""run_reset marks unfinished past runs `missed` (not `cancelled`) so streaks and boost see them."""

from datetime import date, timedelta

import pytest
from app.models.chores import ChoreRun
from app.models.family import get_family
from app.services import boost
from app.services import chores as svc
from app.services import progression as pr

from tests.factories import make_run

T = date(2026, 11, 4)


@pytest.fixture(autouse=True)
def _utc(db):
    fam = get_family(db)
    fam.timezone, fam.last_reset_date = "UTC", None
    db.commit()


def _ago(n):
    return T - timedelta(days=n)


def _status(db, run):
    db.refresh(run)
    return run.status


def _done_days(db, parent, kid, ns):
    for n in ns:
        make_run(db, parent, kid, day=_ago(n), title=f"d{n}", status="done")


def test_reset_marks_past_todo_missed_and_leaves_today(db, parent, kid):
    past = make_run(db, parent, kid, day=_ago(1), title="p")
    today = make_run(db, parent, kid, day=T, title="t")
    svc.run_reset(db, T)
    assert _status(db, past) == "missed"
    assert _status(db, today) == "todo"


def test_reset_keeps_done_and_cancels_submitted(db, parent, kid):
    done = make_run(db, parent, kid, day=_ago(1), title="a", status="done")
    sub = make_run(db, parent, kid, day=_ago(2), title="b", status="submitted")
    svc.run_reset(db, T)
    assert _status(db, done) == "done"
    assert _status(db, sub) == "cancelled"


def test_fully_missed_day_breaks_a_five_day_streak(db, parent, kid):
    _done_days(db, parent, kid, [2, 3, 4, 5, 6])
    make_run(db, parent, kid, day=_ago(1), title="m")
    svc.run_reset(db, T)
    days = pr.chore_days(db, kid.id, T)
    assert days[_ago(1)] is False
    s = pr.streak_with_freezes(days, T)
    assert s.current == 0 and s.runs == [5] and s.frozen == []


def test_a_freeze_covers_the_missed_day(db, parent, kid):
    _done_days(db, parent, kid, range(2, 9))  # 7 done days earn a freeze
    make_run(db, parent, kid, day=_ago(1), title="m")
    svc.run_reset(db, T)
    s = pr.streak_with_freezes(pr.chore_days(db, kid.id, T), T)
    assert s.current == 7 and s.frozen == [_ago(1)]


def test_partly_missed_day_is_not_complete(db, parent, kid):
    make_run(db, parent, kid, day=_ago(1), title="a", status="done")
    make_run(db, parent, kid, day=_ago(1), title="b")
    svc.run_reset(db, T)
    assert pr.chore_days(db, kid.id, T)[_ago(1)] is False


def test_retired_chore_cancel_does_not_count(db, parent, kid):
    _done_days(db, parent, kid, [2, 3])
    run = make_run(db, parent, kid, day=_ago(1), title="gone", status="cancelled")
    svc.run_reset(db, T)
    assert _status(db, run) == "cancelled"
    assert _ago(1) not in pr.chore_days(db, kid.id, T)


def test_pre_upgrade_cancelled_rows_stay_ignored(db, parent, kid):
    _done_days(db, parent, kid, [3, 4, 5, 6, 7])
    make_run(db, parent, kid, day=_ago(2), title="old", status="cancelled")
    make_run(db, parent, kid, day=_ago(1), title="old2", status="cancelled")
    svc.run_reset(db, T)
    days = pr.chore_days(db, kid.id, T)
    assert _ago(1) not in days and _ago(2) not in days
    assert pr.streak_of(days, T).current == 5


def test_quiet_kids_sees_two_reset_missed_days(db, parent, kid):
    for n in (1, 2):
        make_run(db, parent, kid, day=_ago(n), title=f"c{n}")
    svc.run_reset(db, T)
    assert db.query(ChoreRun).filter_by(status="missed").count() == 2
    assert boost.quiet_kids(db, T) == [kid.id]


def test_day_runs_hides_missed_like_cancelled(db, parent, kid):
    make_run(db, parent, kid, day=_ago(1), title="m")
    make_run(db, parent, kid, day=_ago(1), title="c", status="cancelled")
    svc.run_reset(db, T)
    assert svc.day_runs(db, _ago(1), skipped=True).count() == 0
