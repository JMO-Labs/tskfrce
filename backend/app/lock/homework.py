"""Homework mode lock logic."""

from dataclasses import replace
from datetime import UTC, datetime

from sqlalchemy import and_
from sqlalchemy.orm import Session

from app.lock import hours
from app.lock.rules import DeviceFacts
from app.models import Device, HomeworkSite, Override
from app.services.homework_domains import STARTER


def homework_cap(facts: DeviceFacts, now_local: datetime, until: datetime) -> datetime:
    """`until` (naive UTC) pulled back to the device's next schedule change, if sooner."""
    nxt = hours.next_transition(facts.allowed_sets, facts.off, now_local)
    if nxt is None:
        return until
    return min(until, nxt.astimezone(UTC).replace(tzinfo=None))


def clamp(facts: DeviceFacts, overrides: list[Override], now_local: datetime) -> DeviceFacts:
    """Pull a live homework timer back when the schedule now changes sooner. Caller commits."""
    if facts.homework_until is None:
        return facts
    until = homework_cap(facts, now_local, facts.homework_until)
    if until == facts.homework_until:
        return facts
    for o in overrides:
        if o.source == "manual" and o.action == "homework":
            o.expires_at = until
    return replace(facts, homework_until=until)


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
        # device_facts only sets homework_until while the override is live
        if not facts.homework_until or device.mac not in blocked:
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
