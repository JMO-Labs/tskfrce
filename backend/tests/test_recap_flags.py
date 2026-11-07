"""Weekly recap: the flags (drops, later, catches, streaks) and the thresholds behind them."""

from datetime import UTC, date, datetime, timedelta

from app.models.family import get_family
from app.models.trust import TrustEvent
from app.services import chores as svc
from app.services import recap
from app.services.recap_flags import flags

from tests.conftest import _make_user
from tests.factories import make_run
from tests.recap_support import (
    W,
    _fill,
    _kinds,
    _long_streak,
    _timed,
    _utc,  # noqa: F401  (autouse fixture)
    _week,
)


def test_dropping_fires_with_real_percent(db, parent, kid):
    _fill(db, parent, kid, [6, 6, 6, 6, 3, 3])
    f = _week(db)["kids"][0]["flags"]
    assert [(x["kind"], x["action"]) for x in f] == [("dropping", "happy_hour")]
    assert f[0]["text"] == "Timmy's chores are down 50% over 2 weeks."


def test_dropping_at_threshold_and_just_under(db, parent, kid):
    _fill(db, parent, kid, [10, 10, 10, 10, 7, 7])
    assert _kinds(_week(db)) == ["dropping"]  # exactly 30% down
    kid2 = _make_user(db, "kid2", kid.role)
    _fill(db, parent, kid2, [10, 10, 10, 10, 8, 8])  # 20% down
    assert _kinds(_week(db)) == ["dropping"]  # still only timmy


def test_dropping_needs_baseline_of_five(db, parent, kid):
    _fill(db, parent, kid, [4, 4, 4, 4, 1, 1])
    assert _kinds(_week(db)) == []


def test_holiday_week_not_a_drop(db, parent, kid):
    _fill(db, parent, kid, [6, 6, 6, 6, 6, 0])  # nothing assigned in the last week
    assert _kinds(_week(db)) == []


def test_new_kid_no_trends(db, parent, kid):
    _fill(db, parent, kid, [0, 0, 0, 0, 0, 3])
    k = _week(db)["kids"][0]
    assert (k["enough_history"], k["flags"], k["done"]) == (False, [], 3)


def test_later_fires_at_20_points_and_not_under(db, parent, kid):
    for w in range(4):
        _timed(db, parent, kid, w, 3)
    _timed(db, parent, kid, 4, 5, late=1)
    _timed(db, parent, kid, 5, 5, late=1)  # 80% against 100%: 20 points down
    d = _week(db)
    assert d["kids"][0]["flags"] == [
        {
            "kind": "later",
            "text": "Timmy is finishing chores later than usual.",
            "action": "kid",
            "now": 80,
            "was": 100,
        }
    ]


def test_later_just_under(db, parent, kid):
    for w in range(4):
        _timed(db, parent, kid, w, 3)
    _timed(db, parent, kid, 4, 5)
    _timed(db, parent, kid, 5, 10, late=1)  # 15 of 15 minus one late: ~93%
    assert _kinds(_week(db)) == []


def test_later_needs_five_deadline_chores_in_baseline(db, parent, kid):
    _timed(db, parent, kid, 0, 2)
    _timed(db, parent, kid, 1, 2)
    _timed(db, parent, kid, 4, 3, late=3)
    _timed(db, parent, kid, 5, 3, late=3)
    assert _kinds(_week(db)) == []


def test_on_time_excludes_no_deadline(db, parent, kid):
    _fill(db, parent, kid, [0, 0, 0, 0, 0, 3])  # no due time
    _timed(db, parent, kid, 5, 1)
    k = _week(db)["kids"][0]
    assert k["on_time_pct"] == 100 and k["done"] == 4


def test_unfinished_deadline_chore_is_not_on_time(db, parent, kid):
    _timed(db, parent, kid, 5, 1)
    make_run(db, parent, kid, day=W + timedelta(days=1), due_time="12:00")  # never finished
    assert _week(db)["kids"][0]["on_time_pct"] == 50


def test_catches_two_fire_one_does_not(db, parent, kid):
    db.add(TrustEvent(kid_id=kid.id, kind="catch", at=datetime(2026, 11, 3, 9)))
    db.commit()
    assert _kinds(_week(db)) == []
    db.add(TrustEvent(kid_id=kid.id, kind="catch", at=datetime(2026, 11, 8, 23, 59)))
    db.add(TrustEvent(kid_id=kid.id, kind="catch", at=datetime(2026, 11, 9, 0, 1)))  # next week
    db.commit()
    f = _week(db)["kids"][0]["flags"]
    assert (f[0]["kind"], f[0]["action"]) == ("catches", "trust")
    assert f[0]["text"] == "Timmy had 2 spot-check catches this week."


def _reset(db, day=date(2026, 11, 8)):
    """The morning reset: older to-do runs become missed, as in production."""
    svc.run_reset(db, day)
    db.commit()


def _streak(db, parent, kid, days):
    for i in range(days):
        make_run(db, parent, kid, status="done", approved=True, day=W - timedelta(days=days - i))
    for i in range(7):  # this week: assigned, none done
        make_run(db, parent, kid, day=W + timedelta(days=i))
    _reset(db)


def test_streak_ended_fires(db, parent, kid):
    _streak(db, parent, kid, 12)
    f = _week(db)["kids"][0]["flags"]
    (ended,) = [x for x in f if x["kind"] == "streak_ended"]
    assert (ended["text"], ended["action"]) == ("Timmy's 12-day streak ended this week.", "kid")


def test_short_streak_ending_is_quiet(db, parent, kid):
    _streak(db, parent, kid, 6)
    assert _kinds(_week(db)) == []


def test_streak_going_is_quiet(db, parent, kid):
    for i in range(15):
        make_run(db, parent, kid, status="done", approved=True, day=W + timedelta(days=6 - i))
    k = _week(db)["kids"][0]
    assert (k["flags"], k["streak"]) == ([], 15)


def test_cap_three_flags_in_order():
    b = {
        "done": [10, 10, 10, 10, 2, 2],
        "assigned": [10] * 6,
        "ontime": [(5, 5)] * 4 + [(0, 5)] * 2,
    }
    out = flags("Sam", b, 3, 9, True)
    assert [f["kind"] for f in out] == ["catches", "dropping", "later"]


def test_flags_carry_the_numbers_they_fired_on():
    b = {
        "done": [10, 10, 10, 10, 2, 2],
        "assigned": [10] * 6,
        "ontime": [(5, 5)] * 4 + [(0, 5)] * 2,
    }
    by = {f["kind"]: f for f in flags("Sam", b, 3, 9, True)}
    assert by["catches"]["count"] == 3
    assert (by["dropping"]["now"], by["dropping"]["was"]) == (2, 10)
    assert (by["later"]["now"], by["later"]["was"]) == (0, 100)
    assert flags("Sam", b, 0, 9, False)[0]["count"] == 9


def test_all_good(db, parent, kid):
    _fill(db, parent, kid, [3, 3, 3, 3, 3, 3])
    d = _week(db)
    assert d["all_good"] and d["kids"][0]["flags"] == []


# --- missed chores, streaks, thresholds (fix round 1) -------------------------------------------


def _b(done, assigned=None, ontime=None):
    return {
        "done": done,
        "assigned": assigned or [10] * 6,
        "ontime": ontime or [(5, 5)] * 6,
    }


def test_fully_missed_weeks_fire_dropping_after_reset(db, parent, kid):
    _fill(db, parent, kid, [6, 6, 6, 6, 0, 0])
    for wk in (4, 5):
        for j in range(6):
            make_run(db, parent, kid, day=W - timedelta(weeks=5 - wk) + timedelta(days=j))
    _reset(db)
    d = _week(db)
    assert d["kids"][0]["flags"][0]["text"] == "Timmy's chores are down 100% over 2 weeks."
    assert not d["all_good"]


def test_missed_deadline_chores_stay_not_on_time_after_reset(db, parent, kid):
    _timed(db, parent, kid, 5, 2)
    for j in range(4):
        make_run(db, parent, kid, day=W + timedelta(days=j), due_time="12:00")
    assert _week(db)["kids"][0]["on_time_pct"] == 33  # before the reset
    _reset(db)
    assert _week(db)["kids"][0]["on_time_pct"] == 33  # and after


def test_waiting_run_is_assigned_not_done_and_judged_on_submit_time(db, parent, kid):
    day = W + timedelta(days=1)
    make_run(db, parent, kid, status="submitted", day=day, due_time="12:00",
             submitted_at=datetime(2026, 11, 3, 10))  # fmt: skip
    k = _week(db)["kids"][0]
    assert (k["done"], k["on_time_pct"]) == (0, 100)


def test_submit_exactly_at_deadline_is_on_time(db, parent, kid):
    day = W + timedelta(days=1)
    make_run(db, parent, kid, status="done", approved=True, day=day, due_time="12:00",
             submitted_at=datetime(2026, 11, 3, 12))  # fmt: skip
    assert _week(db)["kids"][0]["on_time_pct"] == 100


def test_future_deadline_on_todo_run_not_counted(db, parent, kid):
    make_run(db, parent, kid, day=date(2026, 11, 8), due_time="23:00")  # NOW is 20:00
    assert _week(db)["kids"][0]["on_time_pct"] is None


def test_streak_ended_after_reset_gives_true_length(db, parent, kid):
    _streak(db, parent, kid, 12)
    k = _week(db)["kids"][0]
    assert "Timmy's 12-day streak ended this week." in [f["text"] for f in k["flags"]]
    assert k["streak"] == 0


def test_streak_reaching_seven_inside_the_week_and_ending_flags(db, parent, kid):
    for d in (date(2026, 10, 30), date(2026, 10, 31), date(2026, 11, 1)):
        make_run(db, parent, kid, status="done", approved=True, day=d, title=str(d))
    for i in range(4):
        make_run(db, parent, kid, status="done", approved=True, day=W + timedelta(days=i))
    make_run(db, parent, kid, day=W + timedelta(days=4))  # Friday missed
    _reset(db)
    texts = [f["text"] for f in _week(db)["kids"][0]["flags"]]
    assert "Timmy's 7-day streak ended this week." in texts


def test_ended_streak_quotes_length_that_ended(db, parent, kid):
    for i in range(10):
        make_run(db, parent, kid, status="done", approved=True, day=W - timedelta(days=10 - i))
    for i in range(4):
        make_run(db, parent, kid, status="done", approved=True, day=W + timedelta(days=i))
    make_run(db, parent, kid, day=W + timedelta(days=4))
    _reset(db)
    texts = [f["text"] for f in _week(db)["kids"][0]["flags"]]
    assert "Timmy's 14-day streak ended this week." in texts


def test_open_chore_day_after_midnight_is_not_a_miss(db, parent, kid):
    for i in range(20):
        make_run(
            db, parent, kid, status="done", approved=True, day=date(2026, 11, 7) - timedelta(days=i)
        )
    make_run(db, parent, kid, day=date(2026, 11, 8))  # Sunday's chore, still open
    mon_3am = datetime(2026, 11, 9, 3, 0, tzinfo=UTC)  # chore day is still Sunday (reset 06:00)
    k = recap.week_of(db, W, mon_3am)["kids"][0]
    assert (k["flags"], k["streak"]) == ([], 20)


def test_freeze_carries_streak_over_a_miss(db, parent, kid):
    get_family(db).streak_freeze = True
    for i in range(10):
        make_run(db, parent, kid, status="done", approved=True, day=W - timedelta(days=8 - i))
    make_run(db, parent, kid, day=W + timedelta(days=2))  # one missed day
    for d in (3, 4):
        make_run(db, parent, kid, status="done", approved=True, day=W + timedelta(days=d))
    _reset(db)
    k = _week(db)["kids"][0]
    assert "streak_ended" not in [f["kind"] for f in k["flags"]] and k["streak"] >= 10


def test_history_gate(db, parent, kid):
    _fill(db, parent, kid, [0, 0, 0, 10, 0, 1])  # one earlier week of runs: no trends yet
    k = _week(db)["kids"][0]
    assert (k["enough_history"], k["flags"]) == (False, [])


def test_thresholds_pure():
    # dropping: 27.5% down is quiet, 30% fires
    assert flags("A", _b([20] * 4 + [15, 14]), 0, 0, True) == []
    assert [f["kind"] for f in flags("A", _b([10] * 4 + [7, 7]), 0, 0, True)] == ["dropping"]

    def later(recent_ontime):
        ot = [(100, 100), (0, 0), (0, 0), (0, 0), (recent_ontime, 100), (0, 0)]
        return [f["kind"] for f in flags("A", _b([10] * 6, ontime=ot), 0, 0, True)]

    assert later(90) == [] and later(81) == []  # 10 and 19 points down
    assert later(80) == ["later"]  # exactly 20
    # exact boundary where a float compare would miss: 25/30 against 19/30 is exactly 20 points
    ot = [(25, 30), (0, 0), (0, 0), (0, 0), (19, 30), (0, 0)]
    assert [f["kind"] for f in flags("A", _b([10] * 6, ontime=ot), 0, 0, True)] == ["later"]


def test_names_are_cleaned_and_capped():
    out = flags("Sam\nEvil\x07 " + "x" * 80, _b([1] * 6), 2, 0, True)
    text = out[0]["text"]
    assert "\n" not in text and "\x07" not in text
    assert text.startswith("Sam Evil ") and text.index(" had") == 40


# --- fix round 2 -----------------------------------------------------------------------------


def test_sunday_before_reset_with_saturday_open_is_not_a_miss(db, parent, kid):
    _long_streak(db, parent, kid, date(2026, 11, 6))
    make_run(db, parent, kid, day=date(2026, 11, 7))  # Saturday's chore, still open
    sun_3am = datetime(2026, 11, 8, 3, 0, tzinfo=UTC)  # chore day is still Saturday
    k = recap.week_of(db, None, sun_3am)["kids"][0]
    assert (k["flags"], k["streak"]) == ([], 20)


def test_miss_on_the_last_day_of_the_week_ends_the_streak_that_week(db, parent, kid):
    for i in range(10):
        make_run(
            db, parent, kid, status="done", approved=True, day=date(2026, 11, 7) - timedelta(days=i)
        )
    make_run(db, parent, kid, day=date(2026, 11, 8))  # Sunday missed
    _reset(db, date(2026, 11, 9))
    texts = [
        f["text"]
        for f in recap.week_of(db, W, datetime(2026, 11, 9, 12, tzinfo=UTC))["kids"][0]["flags"]
    ]
    assert "Timmy's 10-day streak ended this week." in texts


def test_waiting_run_with_future_deadline_counts_as_on_time(db, parent, kid):
    make_run(db, parent, kid, status="submitted", day=date(2026, 11, 8), due_time="23:00",
             submitted_at=datetime(2026, 11, 8, 10))  # fmt: skip
    assert _week(db)["kids"][0]["on_time_pct"] == 100


def test_done_run_without_submit_time_uses_approval_time(db, parent, kid):
    r = make_run(
        db, parent, kid, status="done", approved=True, day=W + timedelta(days=1), due_time="12:00"
    )
    r.approved_at = datetime(2026, 11, 3, 11)
    db.commit()
    assert _week(db)["kids"][0]["on_time_pct"] == 100
