"""Manual lock/unlock/homework overrides on devices."""

from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from app.lock.homework import homework_cap
from app.lock.rules import block_reason
from app.lock.schedule import local_now
from app.lock.state import Prefetch, device_facts
from app.models.family import get_family
from app.models.lock import Device, Override

HOMEWORK_MINUTES = 60


def clear_override(db: Session, device_ids: list[int]) -> None:
    """Drop manual overrides on these devices. Caller commits."""
    if device_ids:
        db.query(Override).filter(
            Override.device_id.in_(device_ids), Override.source == "manual"
        ).delete(synchronize_session=False)


def set_override(
    db: Session, device_ids: list[int], action: str, minutes: int | None, user_id: int
) -> None:
    """Replace manual overrides on these devices. Caller commits."""
    clear_override(db, device_ids)
    now = datetime.now(UTC).replace(tzinfo=None)
    expires = now + timedelta(minutes=minutes) if minutes else None
    for did in device_ids:
        db.add(
            Override(
                device_id=did,
                action=action,
                source="manual",
                expires_at=expires,
                created_at=now,
                created_by_id=user_id,
            )
        )


def set_homework(
    db: Session, devices: list[Device], minutes: int | None, user_id: int, now_utc: datetime
) -> list[Override]:
    """Homework mode on the currently paused devices; returns the new overrides.

    Replaces an earlier homework timer but keeps a manual lock, so the device stays
    paused underneath. Caller commits.
    """
    fam = get_family(db)
    now_local = local_now(fam.timezone, now_utc)
    if now_utc.tzinfo is None:
        now_utc = now_utc.replace(tzinfo=UTC)
    now = now_utc.astimezone(UTC).replace(tzinfo=None)
    pre = Prefetch(db, devices)
    until = now + timedelta(minutes=minutes or HOMEWORK_MINUTES)
    out = []
    for d in devices:
        f = device_facts(db, d, fam, now_utc, pre)
        if block_reason(f, now_local) is None:
            continue
        db.query(Override).filter_by(device_id=d.id, source="manual", action="homework").delete()
        o = Override(
            device_id=d.id,
            action="homework",
            source="manual",
            expires_at=homework_cap(f, now_local, until),
            created_at=now,
            created_by_id=user_id,
        )
        db.add(o)
        out.append(o)
    return out
