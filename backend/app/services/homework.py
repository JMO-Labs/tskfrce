"""Homework mode: kid-side helpers shared by the kid and parent APIs."""

from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from app.lock.rules import is_online
from app.lock.schedule import local_now
from app.lock.state import Prefetch, device_facts
from app.models.family import get_family
from app.models.homework import HomeworkRequest
from app.models.lock import Device, Override
from app.models.user import User
from app.schemas.lock import utc_z


def paused(db: Session, kid: User, now_utc: datetime) -> bool:
    """True when at least one of the kid's devices is paused."""
    fam = get_family(db)
    devs = list(kid.devices)
    pre = Prefetch(db, devs)
    local = local_now(fam.timezone, now_utc)
    return any(not is_online(device_facts(db, d, fam, now_utc, pre), local) for d in devs)


def pending(db: Session, kid_id: int) -> HomeworkRequest | None:
    return db.query(HomeworkRequest).filter_by(kid_id=kid_id, status="pending").first()


DENY_COOLDOWN = timedelta(minutes=5)


def recently_denied(db: Session, kid_id: int, now_utc: datetime) -> bool:
    """True when a parent said no to this kid within DENY_COOLDOWN."""
    since = now_utc.astimezone(UTC).replace(tzinfo=None) - DENY_COOLDOWN
    q = db.query(HomeworkRequest).filter_by(kid_id=kid_id, status="denied")
    return q.filter(HomeworkRequest.decided_at >= since).first() is not None


def kid_state(db: Session, kid: User, now_utc: datetime) -> dict:
    """`homework` ({until} of the latest live timer, or None) and `homework_pending`."""
    now = now_utc.astimezone(UTC).replace(tzinfo=None)
    live = (
        db.query(Override)
        .join(Device, Device.id == Override.device_id)
        .filter(
            Device.owners.any(User.id == kid.id),
            Override.action == "homework",
            Override.source == "manual",
            Override.expires_at > now,
        )
        .order_by(Override.expires_at.desc())
        .first()
    )
    return {
        "homework": {"until": utc_z(live.expires_at)} if live else None,
        "homework_pending": pending(db, kid.id) is not None,
    }
