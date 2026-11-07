"""Weekly recap: the Sunday message, quiet hours, cutoff, migration and the API."""

import os
import sqlite3
import subprocess
import sys
from datetime import UTC, date, datetime, timedelta

from app.models.family import get_family
from app.models.inbox import Notification
from app.models.notify import NotifyHeld
from app.services import notify, notify_jobs, recap

from tests.conftest import _make_user
from tests.factories import make_run
from tests.recap_support import (
    BACKEND,
    NOW,
    W,
    _fill,
    _long_streak,
    _timed,
    _utc,  # noqa: F401  (autouse fixture)
)
from tests.test_notify_core import _place
from tests.test_query_counts import QueryCounter

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


def test_absurd_week_param_is_not_a_500(client, parent_headers):
    r = client.get("/api/v1/recap?week=0001-01-01", headers=parent_headers)
    assert r.status_code == 200 and r.json()["prev"] is None


def test_body_of_exactly_300_chars_is_kept_whole():
    lines = ["a" * 99, "b" * 99, "c" * 100]
    assert recap._body(lines) == "\n".join(lines)
    assert recap._body([*lines[:2], "c" * 101]).endswith("and 1 more")


def test_late_reset_time_does_not_send_a_false_streak_end(db, parent, kid):
    get_family(db).reset_time = "20:00"  # at 19:30 Sunday the chore day is still Saturday
    _long_streak(db, parent, kid, date(2026, 11, 6))
    make_run(db, parent, kid, day=date(2026, 11, 7))
    _send(db, SUN)
    assert _recaps(db)[0].body == "All good this week"
