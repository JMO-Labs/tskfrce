"""Happy Hour: start, stop and look up the multiplier window. Callers commit."""

from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.models.happy_hour import HappyHour
from app.models.user import User, UserRole
from app.schemas.lock import utc_z
from app.services import inbox

MULTS = (15, 20, 30)
MINUTES = (30, 60, 90)
SOURCES = ("parent", "schedule", "auto")
STARTED = "Happy Hour started!"


def _kids(db: Session) -> list[int]:
    q = db.query(User.id).filter(User.role == UserRole.KID, User.is_active).order_by(User.id)
    return [i for (i,) in q]


def running(db: Session, now: datetime) -> list[HappyHour]:
    """Happy Hours open at `now` (naive UTC), newest first."""
    q = db.query(HappyHour).filter(HappyHour.starts_at <= now, HappyHour.ends_at > now)
    return q.order_by(HappyHour.id.desc()).all()


def covers(hh: HappyHour, kid_id: int | None) -> bool:
    """None (no single kid, e.g. a parent marks a shared run done) needs an all-kids one."""
    return hh.kid_ids is None or (kid_id is not None and kid_id in hh.kid_ids)


def best(hhs: list[HappyHour], kid_id: int | None) -> HappyHour | None:
    """The highest multiplier among `hhs` that covers this kid, or None."""
    return max((h for h in hhs if covers(h, kid_id)), key=lambda h: h.mult_x10, default=None)


def active_for(db: Session, kid_id: int | None, now: datetime) -> HappyHour | None:
    """The best Happy Hour covering this kid at `now` (naive UTC), or None."""
    return best(running(db, now), kid_id)


def start(
    db: Session,
    *,
    kid_ids: list[int] | None,
    minutes: int,
    mult_x10: int,
    source: str,
    by: int | None,
    now: datetime | None = None,
) -> HappyHour:
    """Open a Happy Hour now and tell each covered kid once."""
    if minutes not in MINUTES or mult_x10 not in MULTS or source not in SOURCES:
        raise ValueError("Pick 30, 60 or 90 minutes and x1.5, x2 or x3.")
    now = now or datetime.utcnow()
    ids = sorted(set(kid_ids) & set(_kids(db))) if kid_ids else None
    if ids == []:
        raise ValueError("Pick at least one kid.")
    hh = HappyHour(
        starts_at=now,
        ends_at=now + timedelta(minutes=minutes),
        mult_x10=mult_x10,
        source=source,
        kid_ids=ids,
        created_by=by,
    )
    db.add(hh)
    db.flush()
    inbox.notify(db, ids or _kids(db), "happy_hour", STARTED, dedup_key=f"hh:{hh.id}")
    return hh


def stop(hh: HappyHour, now: datetime | None = None) -> None:
    now = now or datetime.utcnow()
    if hh.ends_at > now:
        hh.ends_at = max(now, hh.starts_at)


def out(hh: HappyHour) -> dict:
    return {
        "id": hh.id,
        "starts_at": utc_z(hh.starts_at),
        "ends_at": utc_z(hh.ends_at),
        "multiplier": hh.mult_x10 / 10,
        "mult_x10": hh.mult_x10,
        "source": hh.source,
        "kid_ids": hh.kid_ids,
        "created_by": hh.created_by,
    }
