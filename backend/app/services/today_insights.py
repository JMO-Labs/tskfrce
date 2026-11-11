"""Data for the Today Goals and This week cards (no new tables; derived from runs and goals)."""

import math
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.models.chores import ChoreRun
from app.models.family import get_family
from app.models.goal import Goal, GoalContribution
from app.services import chores as chore_svc
from app.services import goals as goal_svc

GOAL_PCT = 75
SERIES_DAYS = 14
WHEN_DAYS = 28
EARN_DAYS = 7


def _utc_naive(dt: datetime) -> datetime:
    return dt.astimezone(UTC).replace(tzinfo=None)


def _done_at(r: ChoreRun) -> datetime | None:
    return r.submitted_at or r.completed_at or r.approved_at


def _due_utc(r: ChoreRun, tz: ZoneInfo) -> datetime | None:
    """The run's due moment in UTC; None when the chore has no due time (due by end of day)."""
    due = r.assignment.due_time if r.assignment else None
    if not due:
        return None
    return _utc_naive(datetime.combine(r.day, time.fromisoformat(due), tzinfo=tz))


def _on_time(r: ChoreRun, tz: ZoneInfo) -> bool:
    done = _done_at(r)
    if done is None:
        return True
    due = _due_utc(r, tz)
    if due is not None:
        return done <= due
    return done.replace(tzinfo=UTC).astimezone(tz).date() <= r.day


def _rate(done: int, total: int) -> int | None:
    return round(100 * done / total) if total else None


def _slot(dt: datetime, tz: ZoneInfo) -> tuple[int, int]:
    loc = dt.replace(tzinfo=UTC).astimezone(tz)
    return (0 if loc.hour < 12 else 1 if loc.hour < 17 else 2), loc.weekday()


def week(db: Session, today: date, tz: ZoneInfo) -> dict:
    first = today - timedelta(days=WHEN_DAYS - 1)
    runs = (
        db.query(ChoreRun)
        .options(joinedload(ChoreRun.assignment))
        .filter(ChoreRun.day >= first, ChoreRun.day <= today)
        .filter(ChoreRun.status.in_(("done", "missed", "submitted", "todo")))
        .all()
    )
    per: dict[date, list[int]] = {}  # day -> [on time, counted]
    when = [[0] * 7 for _ in range(3)]
    for r in runs:
        if r.status == "done":
            d = _done_at(r)
            if d is not None and (d.replace(tzinfo=UTC).astimezone(tz).date() >= first):
                s, w = _slot(d, tz)
                when[s][w] += 1
        if r.status in ("submitted", "todo") and r.day >= today:
            continue  # still has time: not late yet
        c = per.setdefault(r.day, [0, 0])
        c[1] += 1
        c[0] += r.status == "done" and _on_time(r, tz)
    days = [today - timedelta(days=i) for i in range(SERIES_DAYS - 1, -1, -1)]
    series = [
        {"day": d.isoformat(), "rate": _rate(*per.get(d, [0, 0])), "done": per.get(d, [0, 0])[0], "total": per.get(d, [0, 0])[1]}
        for d in days
    ]

    def pooled(ds: list[date]) -> int | None:
        return _rate(sum(per.get(d, [0, 0])[0] for d in ds), sum(per.get(d, [0, 0])[1] for d in ds))

    cur = pooled(days[7:])
    prev = pooled(days[:7])
    return {
        "rate": cur,
        "delta": None if cur is None or prev is None else cur - prev,
        "goal": GOAL_PCT,
        "series": series,
        "when": when,
        "has_history": bool(per),
    }


def goals(db: Session, now: datetime) -> list[dict]:
    since = _utc_naive(now) - timedelta(days=EARN_DAYS)
    earned = dict(
        db.query(GoalContribution.goal_id, func.sum(GoalContribution.amount))
        .filter(GoalContribution.amount > 0, GoalContribution.created_at >= since)
        .group_by(GoalContribution.goal_id)
        .all()
    )
    out = []
    for g in db.query(Goal).filter(Goal.status == "active", Goal.target > 0).all():
        saved = goal_svc.saved(db, g.id)
        rate = (earned.get(g.id) or 0) / EARN_DAYS
        left = max(g.target - saved, 0)
        eta = 0 if left == 0 else math.ceil(left / rate) if rate > 0 else None
        out.append(
            {
                "id": g.id,
                "name": g.name,
                "kid_id": g.kid_id,
                "family": g.kid_id is None,
                "saved": saved,
                "target": g.target,
                "pct": min(100, max(0, round(100 * saved / g.target))),
                "eta_days": eta,
            }
        )
    return sorted(out, key=lambda x: (-x["pct"], x["id"]))


def insights(db: Session) -> dict:
    now = datetime.now(UTC)
    tz = ZoneInfo(get_family(db).timezone)
    return {"goals": goals(db, now), "week": week(db, chore_svc.today(db, now), tz)}
