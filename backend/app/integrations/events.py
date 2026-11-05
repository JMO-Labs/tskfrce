"""Events out: a per-install outbox, trimmed to the grant, delivered in small batches."""

import json
import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.integrations import health, store
from app.integrations.apply import apply_actions
from app.integrations.permissions import Grant
from app.models.integration import IntegrationEvent, IntegrationInstall
from app.models.user import User
from app.services.chat_extras import first_name

log = logging.getLogger(__name__)

EVENT_PERM = {
    "chore.completed": "events.chore_completed",
    "request.created": "events.request_created",
    "reward.redeemed": "events.reward_redeemed",
}
FIELDS = {
    "chore.completed": ("chore_id", "title", "points"),
    "request.created": ("type", "id", "title", "cost"),
    "reward.redeemed": ("reward_name", "cost"),
}
BATCH = 50
TTL = timedelta(hours=24)
MAX_QUEUED = 500  # per install; with the 24 h TTL this bounds the outbox


def _chore_title(kind: str, fields: dict) -> bool:
    return kind == "chore.completed" or (
        kind == "request.created" and fields.get("type") == "chore"
    )


def trim(
    grant: Grant, kind: str, kid_id: int, kid_first_name: str, fields: dict, at: datetime
) -> dict:
    """Only what the grant covers: names with kid.name, chore titles with chores.complete."""
    out = {"kind": kind, "at": at.isoformat(), "kid_id": kid_id}
    if "kid.name" in grant.permissions:
        out["first_name"] = kid_first_name
    keep = set(FIELDS[kind])
    if _chore_title(kind, fields) and "chores.complete" not in grant.permissions:
        keep.discard("title")
    out.update({k: v for k, v in fields.items() if k in keep})
    return out


def _wants(grant: Grant, kind: str, kid_id: int, chore_id: int | None) -> bool:
    return (
        grant.active
        and EVENT_PERM[kind] in grant.permissions
        and kid_id in grant.kid_ids
        and (chore_id is None or chore_id in grant.chore_ids)
    )


def emit(
    db: Session,
    kind: str,
    kid_ids: list[int],
    *,
    chore_id: int | None = None,
    skip_install_id: int | None = None,
    **fields,
) -> None:
    """Queue the event for every active install that may see it. Never raises: the
    caller's action must not fail because of integrations. The caller commits."""
    try:
        with db.begin_nested():
            now = datetime.now(UTC).replace(tzinfo=None)
            installs = (
                db.query(IntegrationInstall).filter_by(status="active", source="catalog").all()
            )
            for inst in installs:
                if inst.id == skip_install_id:
                    continue
                grant = store.load_grant(db, inst)
                for kid_id in kid_ids:
                    if not _wants(grant, kind, kid_id, chore_id):
                        continue
                    name = first_name(db.get(User, kid_id))
                    payload = trim(grant, kind, kid_id, name, dict(fields, chore_id=chore_id), now)
                    db.add(
                        IntegrationEvent(
                            install_id=inst.id,
                            kind=kind,
                            payload=json.dumps(payload),
                            created_at=now,
                        )
                    )
    except Exception:
        log.exception("Integration event %s was not queued", kind)


def _prune(db: Session, now: datetime) -> None:
    """Drop expired events and anything past the per-install cap (oldest first)."""
    db.query(IntegrationEvent).filter(IntegrationEvent.created_at < now - TTL).delete()
    over = (
        db.query(IntegrationEvent.install_id)
        .group_by(IntegrationEvent.install_id)
        .having(func.count() > MAX_QUEUED)
        .all()
    )
    for (install_id,) in over:
        keep = (
            db.query(IntegrationEvent.id)
            .filter_by(install_id=install_id)
            .order_by(IntegrationEvent.id.desc())
            .limit(MAX_QUEUED)
        )
        db.query(IntegrationEvent).filter(
            IntegrationEvent.install_id == install_id, IntegrationEvent.id.not_in(keep)
        ).delete(synchronize_session=False)


def _send(db: Session, inst: IntegrationInstall) -> None:
    rows = (
        db.query(IntegrationEvent)
        .filter_by(install_id=inst.id)
        .order_by(IntegrationEvent.id)
        .limit(BATCH)
        .all()
    )
    grant = store.load_grant(db, inst)
    payloads, ids = [], [r.id for r in rows]
    for r in rows:  # re-check: a kid or chore may have been unlinked since it was queued
        p = json.loads(r.payload)
        if _wants(grant, r.kind, p.get("kid_id"), None):
            payloads.append(p)
    if not payloads:
        db.query(IntegrationEvent).filter(IntegrationEvent.id.in_(ids)).delete()
        db.commit()
        return
    reply = health.guarded_call(db, inst, lambda c: c.events(payloads))
    if reply is None:
        for r in rows:
            r.attempts = (r.attempts or 0) + 1
        db.commit()
        return
    db.query(IntegrationEvent).filter(IntegrationEvent.id.in_(ids)).delete()
    db.commit()
    apply_actions(db, inst, reply.actions)


def flush(db: Session, now: datetime) -> None:
    """Loop step. Prune and commit first, so no write lock is held during the sends."""
    _prune(db, now)
    db.commit()
    installs = (
        db.query(IntegrationInstall)
        .filter(
            IntegrationInstall.status == "active",
            IntegrationInstall.id.in_(db.query(IntegrationEvent.install_id)),
        )
        .all()
    )
    for inst in installs:
        _send(db, inst)
