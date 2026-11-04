"""Homework mode lock logic."""

from datetime import datetime

from sqlalchemy import and_
from sqlalchemy.orm import Session

from app.lock.rules import DeviceFacts
from app.models import Device, HomeworkSite
from app.services.homework_domains import STARTER


def effective_allow(db: Session, kid_id: int | None) -> list[str]:
    """
    Build the effective allow list for a device.

    Returns: starter + family allows + (that kid's allows if kid_id is provided).
    De-duplicated and sorted.
    """
    domains = set(STARTER)

    # Add family allows (kid_id IS NULL)
    family_allows = (
        db.query(HomeworkSite)
        .filter(and_(HomeworkSite.kid_id.is_(None), HomeworkSite.kind == "allow"))
        .all()
    )
    domains.update(s.domain for s in family_allows)

    # Add kid-specific allows if kid_id provided
    if kid_id:
        kid_allows = (
            db.query(HomeworkSite)
            .filter(and_(HomeworkSite.kid_id == kid_id, HomeworkSite.kind == "allow"))
            .all()
        )
        domains.update(s.domain for s in kid_allows)

    return sorted(list(domains))


def block_list(db: Session) -> list[str]:
    """
    Get the family block list for homework mode.

    Returns: all entries where kind='block' and kid_id IS NULL.
    """
    blocks = (
        db.query(HomeworkSite)
        .filter(and_(HomeworkSite.kid_id.is_(None), HomeworkSite.kind == "block"))
        .all()
    )
    return sorted([s.domain for s in blocks])


def state_map(
    db: Session, rows: list[tuple[Device, DeviceFacts]], blocked: set[str]
) -> dict[str, dict]:
    """
    Build the homework state map for the blocker.

    Args:
        db: database session
        rows: list of (Device, DeviceFacts) tuples
        blocked: set of MACs that are blocked

    Returns: {mac: {"allow": [...], "block": [...], "until": iso_z}, ...}
    Only includes devices with homework_until set (i.e. homework mode active).
    """
    result = {}

    for device, facts in rows:
        # Only include if homework_until is set and not expired
        if not facts.homework_until:
            continue

        if facts.homework_until <= datetime.utcnow():
            continue

        # Get kid_id from device (if assigned to a kid)
        kid_id = None
        if device.owners:
            for owner in device.owners:
                if owner.role == "kid":
                    kid_id = owner.id
                    break

        allow = effective_allow(db, kid_id)
        block = block_list(db)

        result[device.mac] = {
            "allow": allow,
            "block": block,
            "until": facts.homework_until.isoformat() + "Z",
        }

    return result
