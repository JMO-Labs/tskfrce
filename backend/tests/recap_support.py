"""Shared helpers for the recap tests."""

from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import pytest
from app.models.family import get_family
from app.services import recap

from tests.factories import make_run

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


def _long_streak(db, parent, kid, last_done):
    for i in range(20):
        make_run(db, parent, kid, status="done", approved=True, day=last_done - timedelta(days=i))
