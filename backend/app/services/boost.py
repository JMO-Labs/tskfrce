"""System-started Happy Hours, run from notify_jobs.tick: auto boost and the weekly surprise."""

import random
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.logging import get_logger
from app.models.chores import ChoreRun, run_kids
from app.models.family import get_family
from app.models.happy_hour import HappyHour
from app.models.user import User, UserRole
from app.services import chores as svc
from app.services import happy_hour, inbox

AUTO_AT = time(16, 0)  # local
CUTOFF = timedelta(hours=2)  # backend down longer than this past the start: skip
AUTO_MINUTES, AUTO_MULT = 60, 20
WEEK_CAP = 2
LOOKBACK = 7  # days back to find the last 2 days that had runs
SURPRISE_HOURS = (16, 17, 18)  # local
log = get_logger(__name__)
QUIET = "{}'s had a quiet couple of days, so we started a Happy Hour for them."


def _naive(dt: datetime) -> datetime:
    return dt.astimezone(UTC).replace(tzinfo=None)


def quiet_kids(db: Session, today: date) -> list[int]:
    """Kids whose last 2 days with runs (looking back LOOKBACK days, days with nothing assigned
    skipped) have none submitted or done, and who have sent nothing in today."""
    kid = func.coalesce(ChoreRun.kid_id, run_kids.c.kid_id)
    rows = (
        db.query(kid, ChoreRun.day, ChoreRun.status)
        .outerjoin(run_kids, run_kids.c.run_id == ChoreRun.id)
        .join(User, User.id == kid)
        .filter(
            ChoreRun.day >= today - timedelta(days=LOOKBACK),
            ChoreRun.day <= today,
            ChoreRun.status.notin_(["cancelled", "skipped"]),
            User.role == UserRole.KID,
            User.is_active,
        )
        .all()
    )
    busy: dict[int, dict[date, bool]] = {}  # kid -> day -> anything sent in
    for kid_id, d, status in rows:
        days = busy.setdefault(kid_id, {})
        days[d] = days.get(d, False) or status in ("submitted", "done")
    out = []
    for kid_id, days in busy.items():
        last = [days[d] for d in sorted(days, reverse=True) if d < today][:2]
        if len(last) == 2 and not any(last) and not days.get(today):
            out.append(kid_id)
    return sorted(out)


def _capped(db: Session, kid_id: int, day_start: datetime, now: datetime) -> bool:
    """Auto Happy Hours for this kid: one already today, or WEEK_CAP in the last 7 days."""
    q = db.query(HappyHour).filter(
        HappyHour.source == "auto", HappyHour.starts_at > now - timedelta(days=7)
    )
    mine = [h for h in q if h.kid_ids and kid_id in h.kid_ids]
    return len(mine) >= WEEK_CAP or any(h.starts_at >= day_start for h in mine)


def auto_boost(db: Session, now_utc: datetime) -> None:
    fam = get_family(db)
    tz = ZoneInfo(fam.timezone)
    local = now_utc.astimezone(tz)
    if not fam.hh_auto_boost or local.time() < AUTO_AT or fam.hh_auto_date == local.date():
        return
    fam.hh_auto_date = local.date()
    if local - datetime.combine(local.date(), AUTO_AT, tz) > CUTOFF:
        return
    now = _naive(now_utc)
    day_start = _naive(datetime.combine(local.date(), time(0), tz))
    for kid_id in quiet_kids(db, svc.today(db, now_utc)):
        try:
            with db.begin_nested():  # one kid failing rolls back only their own rows
                _boost(db, kid_id, day_start, now)
        except Exception:
            log.exception("auto boost failed for kid %s", kid_id)


def _boost(db: Session, kid_id: int, day_start: datetime, now: datetime) -> None:
    if _capped(db, kid_id, day_start, now):
        return
    happy_hour.start(
        db,
        kid_ids=[kid_id],
        minutes=AUTO_MINUTES,
        mult_x10=AUTO_MULT,
        source="auto",
        by=None,
        now=now,
    )
    u = db.get(User, kid_id)
    inbox.notify_parents(db, "boost", QUIET.format(u.full_name or u.username)[:120])


def pick_slot(local: datetime, rng: random.Random) -> datetime | None:
    """A random weekday left this week, then a random hour on it; naive local, or None."""
    monday = local.date() - timedelta(days=local.weekday())
    slots = [
        datetime.combine(monday + timedelta(days=n), time(h))
        for n in range(5)
        for h in SURPRISE_HOURS
    ]
    slots = [s for s in slots if s > local]
    if not slots:
        return None
    day = rng.choice(sorted({s.date() for s in slots}))
    return rng.choice([s for s in slots if s.date() == day])


def weekly_surprise(db: Session, now_utc: datetime, rng: random.Random | None = None) -> None:
    fam = get_family(db)
    if not fam.hh_weekly_surprise:
        return
    tz = ZoneInfo(fam.timezone)
    local = now_utc.astimezone(tz)
    monday = local.date() - timedelta(days=local.weekday())
    if fam.hh_surprise_date is None or fam.hh_surprise_date < monday:
        fam.hh_surprise_date = local.date()
        slot = pick_slot(local.replace(tzinfo=None), rng or random.Random())
        fam.hh_surprise_at = _naive(slot.replace(tzinfo=tz)) if slot else None
    at, now = fam.hh_surprise_at, _naive(now_utc)
    if at is None or now < at:
        return
    fam.hh_surprise_at = None
    if now - at <= CUTOFF:
        happy_hour.start(
            db,
            kid_ids=None,
            minutes=fam.hh_default_minutes,
            mult_x10=fam.hh_default_mult_x10,
            source="schedule",
            by=None,
            now=now,
        )


def run(db: Session, now_utc: datetime) -> None:
    auto_boost(db, now_utc)
    weekly_surprise(db, now_utc)
