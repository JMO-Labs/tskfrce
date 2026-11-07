"""Weekly recap: flags, trends, windows, the Sunday message and the API."""

import os
import sqlite3
import subprocess
import sys
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import pytest
from app.models.family import get_family
from app.models.inbox import Notification
from app.models.notify import NotifyHeld
from app.models.points import Points, PointsType
from app.models.reward import Redemption, Reward
from app.models.trust import TrustEvent
from app.services import chores as svc
from app.services import notify, notify_jobs, recap
from app.services.recap_flags import flags

from tests.conftest import _make_user
from tests.factories import make_run
from tests.test_notify_core import _place
from tests.test_query_counts import QueryCounter

BACKEND = Path(__file__).resolve().parents[1]
W = date(2026, 11, 2)  # the selected Monday; the week ends Sunday Nov 8
NOW = datetime(2026, 11, 8, 20, 0, tzinfo=UTC)


@pytest.fixture(autouse=True)
def _utc(db):
    fam = get_family(db)
    fam.timezone, fam.last_reset_date, fam.streak_freeze = "UTC", None, False
    db.commit()


def _fill(db, parent, kid, per_week, **kw):
    """per_week[i] done runs in week i (0 = five weeks before W, 5 = W)."""
    for i, n in enumerate(per_week):
        for j in range(n):
            day = W - timedelta(weeks=5 - i) + timedelta(days=j % 7)
            make_run(db, parent, kid, status="done", approved=True, day=day, **kw)


def _week(db, **kw):
    return recap.week_of(db, W, NOW)


def _kinds(data):
    return [f["kind"] for k in data["kids"] for f in k["flags"]]


def _timed(db, parent, kid, week, n, late=0):
    """n done runs due 12:00, `late` of them submitted after the deadline."""
    for j in range(n):
        day = W - timedelta(weeks=5 - week) + timedelta(days=j % 7)
        hour = 15 if j < late else 10
        make_run(
            db, parent, kid, status="done", approved=True, day=day, due_time="12:00",
            submitted_at=datetime(day.year, day.month, day.day, hour),
        )  # fmt: skip


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
        {"kind": "later", "text": "Timmy is finishing chores later than usual.", "action": "kid"}
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


def test_all_good(db, parent, kid):
    _fill(db, parent, kid, [3, 3, 3, 3, 3, 3])
    d = _week(db)
    assert d["all_good"] and d["kids"][0]["flags"] == []


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


# --- Sunday message -------------------------------------------------------------------------

SUN = datetime(2026, 11, 8, 19, 30, tzinfo=UTC)


def _recaps(db):
    return db.query(Notification).filter_by(kind="recap").all()


def _send(db, now):
    recap.send(db, now)
    db.commit()


def test_send_once(db, parent, kid, pings):
    _place(db)
    _fill(db, parent, kid, [3, 3, 3, 3, 3, 3])
    _send(db, SUN)
    _send(db, SUN + timedelta(minutes=5))
    (n,) = _recaps(db)
    assert n.title.startswith("Your week at ") and n.body == "All good this week"
    assert len(pings) == 1 and pings[0][1] == n.title


def test_send_body_lists_flags(db, parent, kid):
    _fill(db, parent, kid, [6, 6, 6, 6, 3, 3])
    _send(db, SUN)
    assert _recaps(db)[0].body == "Timmy's chores are down 50% over 2 weeks."


def test_send_waits_for_time_and_day(db, parent, kid):
    _send(db, SUN - timedelta(minutes=1))
    _send(db, SUN - timedelta(days=1))
    assert _recaps(db) == []
    _send(db, SUN)
    assert len(_recaps(db)) == 1


def test_send_skips_when_late(db, parent, kid):
    _send(db, SUN + timedelta(hours=2, minutes=1))
    _send(db, SUN + timedelta(hours=2, minutes=5))
    assert _recaps(db) == []
    assert get_family(db).recap_date == SUN.date()  # and not retried that day


def test_dst_sunday_once(db, parent, kid):
    get_family(db).timezone = "America/New_York"
    db.commit()
    for h, m in ((23, 59), (0, 30), (1, 30), (4, 0), (5, 0)):  # 19:30 EST is 00:30Z Nov 2
        d = date(2026, 11, 1) if (h, m) == (23, 59) else date(2026, 11, 2)
        _send(db, datetime(d.year, d.month, d.day, h, m, tzinfo=UTC))
    assert len(_recaps(db)) == 1


def test_off_switch_and_setup(db, parent, kid):
    fam = get_family(db)
    fam.recap_weekly = False
    _send(db, SUN)
    fam.recap_weekly, fam.setup_step = True, 2
    _send(db, SUN)
    assert _recaps(db) == []


def test_tick_runs_recap(db, parent, kid):
    notify_jobs.tick(db, SUN)
    assert len(_recaps(db)) == 1


# --- API, budget, migration -----------------------------------------------------------------


def test_parent_only(client, parent_headers, kid_headers):
    assert client.get("/api/v1/recap").status_code in (401, 403)
    assert client.get("/api/v1/recap", headers=kid_headers).status_code == 403
    r = client.get("/api/v1/recap?week=2026-10-19", headers=parent_headers)
    assert r.status_code == 200 and r.json()["week_start"] == "2026-10-19"


def test_query_budget(db, parent, kid):
    kids = [kid] + [_make_user(db, f"k{i}", kid.role) for i in range(2)]
    for k in kids:
        _fill(db, parent, k, [3, 3, 3, 3, 2, 2])
        _timed(db, parent, k, 5, 2)
    with QueryCounter(db.get_bind()) as q:
        recap.week_of(db, W, NOW)
    assert len(q.statements) <= 30, len(q.statements)


def _alembic(url, *cmd):
    subprocess.run(
        [sys.executable, "-m", "alembic", *cmd],
        cwd=BACKEND,
        env={**os.environ, "DATABASE_URL": url},
        check=True,
        capture_output=True,
    )


def test_existing_place_gets_event_after_migration(tmp_path):
    path = tmp_path / "m.db"
    url = f"sqlite:///{path}"
    _alembic(url, "upgrade", "b1c2d3e4f5a6")
    con = sqlite3.connect(path)
    for name, ev in (
        ("a", "chore_ok,summary"),
        ("b", ""),
        ("c", "recap,summary"),
        ("d", "chore_ok"),
    ):
        con.execute(
            "INSERT INTO notify_places (name, url_enc, url_mask, enabled, events)"
            " VALUES (?, 'x', 'y', 1, ?)",
            (name, ev),
        )
    con.commit()

    def events():
        return dict(con.execute("SELECT name, events FROM notify_places").fetchall())

    _alembic(url, "upgrade", "head")
    assert events() == {
        "a": "chore_ok,summary,recap",
        "b": "",
        "c": "recap,summary",
        "d": "chore_ok",
    }
    _alembic(url, "downgrade", "b1c2d3e4f5a6")
    assert events() == {"a": "chore_ok,summary", "b": "", "c": "summary", "d": "chore_ok"}


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


def test_thresholds_pure():
    # dropping: 27.5% down is quiet, 30% fires
    assert flags("A", _b([20] * 4 + [15, 14]), 0, 0, True) == []
    assert [f["kind"] for f in flags("A", _b([10] * 4 + [7, 7]), 0, 0, True)] == ["dropping"]
    # later: 19 points is quiet, exactly 20 fires, 10 is quiet
    quiet = _b([10] * 6, ontime=[(25, 30), (0, 0), (0, 0), (0, 0), (19, 30), (0, 0)])
    assert [f["kind"] for f in flags("A", quiet, 0, 0, True)] == ["later"]  # 83.3 vs 63.3: exact 20
    quiet["ontime"][4] = (20, 30)
    assert flags("A", quiet, 0, 0, True) == []


def test_names_are_cleaned_and_capped():
    out = flags("Sam\nEvil\x07 " + "x" * 80, _b([1] * 6), 2, 0, True)
    text = out[0]["text"]
    assert "\n" not in text and "\x07" not in text
    assert text.startswith("Sam Evil ") and text.index(" had") == 40


def test_body_never_cuts_mid_line():
    lines = [f"Kid{i} had 2 spot-check catches this week." for i in range(12)]
    body = recap._body(lines)
    assert len(body) <= 300 and body.endswith(" more") and "\nand " in body
    assert all(ln in lines or ln.startswith("and ") for ln in body.split("\n"))
    assert recap._body(lines[:3]) == "\n".join(lines[:3])


def test_quiet_hours_hold_the_recap(db, parent, kid, pings, monkeypatch):
    _place(db)
    monkeypatch.setattr(notify, "in_quiet", lambda f, n: True)
    _send(db, SUN)
    assert pings == [] and db.query(NotifyHeld).count() == 1
    assert len(_recaps(db)) == 1


def test_send_cutoff_edges(db, parent, kid):
    _send(db, SUN + timedelta(hours=1, minutes=15))
    assert len(_recaps(db)) == 1
    get_family(db).recap_date = None
    _send(db, SUN + timedelta(hours=2))  # exactly 2 hours late still sends
    assert len(_recaps(db)) == 2


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


def test_absurd_week_param_is_not_a_500(client, parent_headers):
    r = client.get("/api/v1/recap?week=0001-01-01", headers=parent_headers)
    assert r.status_code == 200 and r.json()["prev"] is None
