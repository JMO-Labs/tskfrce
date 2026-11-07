"""Weekly recap: week windows, counts, trends and money columns."""

from datetime import UTC, date, datetime, timedelta

from app.models.family import get_family
from app.models.points import Points, PointsType
from app.models.reward import Redemption, Reward
from app.models.trust import TrustEvent
from app.services import recap

from tests.conftest import _make_user
from tests.factories import make_run
from tests.recap_support import (
    NOW,
    W,
    _fill,
    _kinds,
    _timed,
    _utc,  # noqa: F401  (autouse fixture)
    _week,
)


def test_done_counts_self_approved_not_waiting(db, parent, kid):
    make_run(db, parent, kid, status="done", day=W)  # approver is not a parent
    r = make_run(db, parent, kid, status="done", day=W + timedelta(days=1))
    r.approved_via = "trust"
    make_run(db, parent, kid, status="submitted", day=W + timedelta(days=2))
    db.commit()
    k = _week(db)["kids"][0]
    assert k["done"] == 1 and k["done_trend"] == [0, 0, 0, 0, 1]


def test_trend_family_line_and_window(db, parent, kid):
    _fill(db, parent, kid, [1, 2, 3, 2, 3, 5])
    d = _week(db)
    assert d["kids"][0]["done_trend"] == [2, 3, 2, 3, 5]
    assert d["family_line"] == "Best week in a month."
    assert (d["week_start"], d["week_end"], d["prev"], d["next"]) == (
        "2026-11-02", "2026-11-08", "2026-10-26", None,
    )  # fmt: skip
    assert recap.week_of(db, W - timedelta(days=7), NOW)["family_line"] is None


def test_default_week_is_last_full_week(db):
    fam = get_family(db)
    assert recap.latest_week(fam, datetime(2026, 11, 8, 23, 0, tzinfo=UTC)) == W
    assert recap.latest_week(fam, datetime(2026, 11, 10, 9, 0, tzinfo=UTC)) == W
    assert recap.latest_week(fam, datetime(2026, 11, 9, 9, 0, tzinfo=UTC)) == W


def test_money_columns(db, parent, kid):
    at = datetime(2026, 11, 4, 12)
    for t, amt in (
        (PointsType.TASK_COMPLETION, 10), (PointsType.BONUS, 5), (PointsType.TRANSFER, 7),
        (PointsType.PENALTY, -3),
    ):  # fmt: skip
        db.add(Points(user_id=kid.id, points_type=t, amount=amt, reason="bonus", created_at=at))
    db.add(Points(user_id=kid.id, points_type=PointsType.BONUS, amount=99, reason="bonus",
                  created_at=datetime(2026, 10, 30)))  # fmt: skip
    rw = Reward(name="Toy", price=20)
    db.add(rw)
    db.flush()
    for st, kind, mins in (("approved", "screen_time", 30), ("approved", "reward", None),
                           ("pending", "screen_time", 60)):  # fmt: skip
        db.add(Redemption(kid_id=kid.id, kind=kind, reward_id=rw.id if kind == 'reward' else None, minutes=mins, cost=20, status=st,
                          decided_at=at))  # fmt: skip
    db.commit()
    k = _week(db)["kids"][0]
    assert (k["points_earned"], k["points_spent"], k["screen_minutes_bought"]) == (15, 40, 30)


def test_inactive_and_parent_excluded(db, parent, kid):
    kid.is_active = False
    db.commit()
    assert _week(db)["kids"] == []


def test_two_earlier_weeks_are_enough(db, parent, kid):
    _fill(db, parent, kid, [0, 0, 0, 10, 10, 1])
    k = _week(db)["kids"][0]
    assert k["enough_history"] and [f["kind"] for f in k["flags"]] == ["dropping"]


def test_recent_window_is_two_weeks(db, parent, kid):
    _fill(db, parent, kid, [10, 10, 10, 10, 3, 10])  # (3 + 10) / 2 against 10
    assert _kinds(_week(db)) == ["dropping"]


def test_baseline_window_is_four_weeks(db, parent, kid):
    _fill(db, parent, kid, [2, 10, 10, 10, 7, 7])  # baseline 8 (not 10): 12% down
    assert _kinds(_week(db)) == []


def test_family_line_looks_back_four_weeks_only(db, parent, kid):
    _fill(db, parent, kid, [9, 1, 2, 3, 4, 5])
    assert _week(db)["family_line"] == "Best week in a month."


def test_on_time_avg_is_mean_of_four_weeks_before(db, parent, kid):
    _timed(db, parent, kid, 0, 2, late=2)  # outside the four
    _timed(db, parent, kid, 1, 2)
    _timed(db, parent, kid, 2, 2, late=1)
    _timed(db, parent, kid, 4, 2, late=2)  # week 3 had no deadlines
    _timed(db, parent, kid, 5, 2)
    k = _week(db)["kids"][0]
    assert (k["on_time_avg"], k["on_time_pct"]) == (50, 100)


def test_skipped_runs_are_a_holiday(db, parent, kid):
    _fill(db, parent, kid, [6, 6, 6, 6, 6, 0])
    for j in range(5):
        make_run(db, parent, kid, status="skipped", day=W + timedelta(days=j))
    assert _kinds(_week(db)) == []


def test_shared_run_counts_for_every_kid(db, parent, kid):
    other = _make_user(db, "kid2", kid.role)
    make_run(db, parent, kids=[kid, other], status="done", approved=True, day=W)
    assert [k["done"] for k in _week(db)["kids"]] == [1, 1]


def test_week_param_snaps_to_monday_and_clamps(db):
    assert recap.week_of(db, date(2026, 11, 5), NOW)["week_start"] == "2026-11-02"
    assert recap.week_of(db, date(2026, 11, 22), NOW)["week_start"] == "2026-11-02"
    far = recap.week_of(db, date(1, 1, 1), NOW)
    assert far["week_start"] == "2000-01-03" and far["prev"] is None
    assert recap.week_of(db, date(2026, 10, 14), NOW)["week_start"] == "2026-10-12"  # a Wednesday


def test_default_week_on_saturday_is_the_week_before(db):
    fam = get_family(db)
    fam.timezone = "America/New_York"
    sat_late = datetime(2026, 11, 8, 4, 30, tzinfo=UTC)  # Saturday 23:30 in New York
    assert recap.latest_week(fam, sat_late) == date(2026, 10, 26)
    sun_late = datetime(2026, 11, 9, 4, 30, tzinfo=UTC)  # Sunday 23:30 in New York
    assert recap.latest_week(fam, sun_late) == W


def test_week_windows_use_family_timezone(db, parent, kid):
    get_family(db).timezone = "America/New_York"
    db.commit()
    at = [(datetime(2026, 11, 9, 4, 30), 5), (datetime(2026, 11, 2, 3, 0), 7)]  # in / out of week
    for when, amt in at:
        db.add(Points(user_id=kid.id, points_type=PointsType.BONUS, amount=amt, reason="bonus",
                      created_at=when))  # fmt: skip
        db.add(TrustEvent(kid_id=kid.id, kind="catch", at=when))
    db.commit()
    k = recap.week_of(db, W, datetime(2026, 11, 9, 12, tzinfo=UTC))["kids"][0]
    assert k["points_earned"] == 5 and k["flags"] == []  # one catch in the week, not two


def test_redemption_window_edges(db, parent, kid):
    for when in (
        datetime(2026, 11, 1, 23, 59, 59),
        datetime(2026, 11, 9, 0, 0),
        datetime(2026, 11, 2),
    ):
        db.add(Redemption(kid_id=kid.id, kind="screen_time", minutes=10, cost=3,
                          status="approved", decided_at=when))  # fmt: skip
    db.commit()
    k = _week(db)["kids"][0]
    assert (k["points_spent"], k["screen_minutes_bought"]) == (3, 10)


def test_points_and_catches_at_local_monday_midnight_belong_to_next_week(db, parent, kid):
    edge = datetime(2026, 11, 9, 0, 0)  # exactly the start of the next week (UTC family)
    db.add(
        Points(
            user_id=kid.id, points_type=PointsType.BONUS, amount=9, reason="bonus", created_at=edge
        )
    )
    db.add(TrustEvent(kid_id=kid.id, kind="catch", at=edge))
    db.add(TrustEvent(kid_id=kid.id, kind="catch", at=datetime(2026, 11, 8, 12)))
    db.commit()
    k = _week(db)["kids"][0]
    assert k["points_earned"] == 0 and k["flags"] == []
