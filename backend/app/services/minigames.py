"""Earning and revoking minigame plays, the daily cap and the asleep window.
Flushes only: callers commit."""

import math
import random
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app.lock import hours
from app.models.chores import ChoreRun
from app.models.game import GamePlay
from app.models.points import Points
from app.services.economy import _recipients

MAX_SAVED = 5


def enabled(fam, kid) -> bool:
    return bool(fam.games_on and kid.games_on)


def saved_count(db: Session, kid_id: int) -> int:
    return db.query(GamePlay).filter(GamePlay.kid_id == kid_id, GamePlay.status == "saved").count()


def counts(db: Session, kid_id: int) -> dict:
    """Saved plays and how many the kid hasn't seen yet (one query)."""
    saved, fresh = (
        db.query(
            func.count(), func.coalesce(func.sum(case((GamePlay.seen.is_(False), 1), else_=0)), 0)
        )
        .filter(GamePlay.kid_id == kid_id, GamePlay.status == "saved")
        .one()
    )
    return {"saved": saved, "fresh": int(fresh)}


def earn(db: Session, run, fam, rng=random) -> list[int]:
    """Give each paid kid a saved play for an approved chore. Returns the kid ids."""
    if getattr(run, "penalty_id", None) is not None:  # make-up chores earn nothing
        return []
    from app.models.user import User

    chore = run.assignment.chore
    got = []
    for kid_id in _recipients(run):
        kid = db.get(User, kid_id)
        if kid is None or not enabled(fam, kid) or saved_count(db, kid_id) >= MAX_SAVED:
            continue
        if fam.games_earn == "daily" and (
            db.query(GamePlay)
            .filter(
                GamePlay.kid_id == kid_id,
                GamePlay.earned_day == run.day,
                GamePlay.status != "revoked",
            )
            .first()
        ):
            continue
        if fam.games_earn == "random" and rng.random() >= 0.5:
            continue
        if fam.games_earn == "custom" and not chore.gives_game:
            continue
        db.add(
            GamePlay(kid_id=kid_id, run_id=run.id, earned_day=run.day, earned_at=datetime.utcnow())
        )
        got.append(kid_id)
    db.flush()
    return got


def revoke(db: Session, run) -> None:
    """Undo: revoke this run's unplayed play, else the newest unplayed one."""
    for kid_id in _recipients(run):
        mine = (
            db.query(GamePlay)
            .filter(GamePlay.kid_id == kid_id, GamePlay.run_id == run.id)
            .filter(GamePlay.status != "revoked")
            .first()
        )
        if mine is None:
            continue
        if mine.status != "saved":
            mine = (
                db.query(GamePlay)
                .filter(GamePlay.kid_id == kid_id, GamePlay.status == "saved")
                .order_by(GamePlay.id.desc())
                .first()
            )
        if mine is not None:
            mine.status = "revoked"
    db.flush()


def cap_for(db: Session, fam, kid_id: int, day: date) -> tuple[int, int]:
    """(points left, max) for plays earned on this chore day."""
    chore_pts = (
        db.query(func.coalesce(func.sum(Points.amount), 0))
        .join(ChoreRun, ChoreRun.id == Points.run_id)
        .filter(Points.user_id == kid_id, Points.amount > 0, ChoreRun.day == day)
        .scalar()
    )
    pct = fam.games_cap_pct
    top = 0 if pct == 0 else max(1, math.ceil(chore_pts * pct / 100))
    used = (
        db.query(func.coalesce(func.sum(GamePlay.points), 0))
        .filter(GamePlay.kid_id == kid_id, GamePlay.status == "done", GamePlay.earned_day == day)
        .scalar()
    )
    return max(0, top - used), top


def _hm(s: str) -> tuple[int, int]:
    h, m = s.split(":")
    return int(h), int(m)


def _bedtime(rules, kid_id: int, d: date) -> str | None:
    """The kid's own bedtime on local date `d`: the end of their last allowed window, from
    their Hours rules (their own and Everyone's). None when no rule gives them one."""
    sets = hours.resolve(rules, {kid_id}, set(), d).allowed_sets
    ends = [max((w.end for w in s if w.start < w.end), default=None) for s in sets]
    ends = [e for e in ends if e]
    return min(ends).strftime("%H:%M") if ends else None


def asleep_until(db: Session, fam, kid, now_utc: datetime) -> datetime | None:
    """End of the asleep window (kid's bedtime to the day reset) we are in, as naive UTC."""
    tz = ZoneInfo(fam.timezone)
    now = now_utc.astimezone(tz)
    t, end = now.strftime("%H:%M"), fam.reset_time
    d = now.date() if t >= end else now.date() - timedelta(days=1)
    start = _bedtime(hours.load(db), kid.id, d)
    if not start or not end or start == end:
        return None
    if start < end:
        inside, next_day = start <= t < end, False
    else:
        inside, next_day = t >= start or t < end, t >= start
    if not inside:
        return None
    h, m = _hm(end)
    day = now.date() + timedelta(days=1 if next_day else 0)
    return (
        datetime(day.year, day.month, day.day, h, m, tzinfo=tz).astimezone(UTC).replace(tzinfo=None)
    )
