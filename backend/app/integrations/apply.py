"""Apply integration actions: grant check, idempotent audit, then the handler."""

import re
from collections.abc import Callable
from datetime import UTC, datetime
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.integrations import audit, store
from app.integrations.audit import ActionResult
from app.integrations.permissions import Denied, Grant, Origin, check_action
from app.integrations.protocol import KEY_PATTERN, Action, parse_action
from app.models.chores import ChoreAssignment, ChoreRun
from app.models.integration import IntegrationInstall
from app.models.user import User
from app.services import chore_actions, inbox
from app.services import chores as svc
from app.services.chat_extras import first_name

Outcome = tuple[str, str | None, dict]  # result, reason, audit refs
Handler = Callable[[Session, IntegrationInstall, Grant, Action, bool], Outcome]


def _chore_complete(
    db: Session, install: IntegrationInstall, grant: Grant, a: Action, needs_approval: bool
) -> Outcome:
    now = datetime.now(UTC).replace(tzinfo=None)
    refs = {"kid_id": a.kid_id, "chore_id": a.chore_id, "created_at": now}
    run = (
        db.query(ChoreRun)
        .join(ChoreAssignment, ChoreRun.assignment_id == ChoreAssignment.id)
        .filter(
            ChoreAssignment.chore_id == a.chore_id,
            ChoreRun.day == svc.today(db, now.replace(tzinfo=UTC)),
            svc.kid_runs_filter(a.kid_id),
        )
        .first()
    )
    if run is None or run.status != "todo":
        return "rejected", "nothing to do today", refs
    refs["run_id"] = run.id
    # Ruling: an integration completion skips the photo requirement. The signal is the proof.
    chore_actions.tick_all(run, a.kid_id, now)
    chore_actions.submit(run, a.kid_id, now)
    if needs_approval:
        kid = db.get(User, a.kid_id)
        inbox.notify_parents(
            db,
            "chore_submitted",
            f"{grant.name}: {first_name(kid)} finished {svc.chore_of(run).title}",
            "Take a look and approve it.",
            run_id=run.id,
        )
        return "pending", None, refs
    chore_actions.approve(db, run, by_id=None)
    return "applied", None, refs


HANDLERS: dict[str, Handler] = {"chore.complete": _chore_complete}


def _key_of(raw: dict) -> str | None:
    k = raw.get("idempotency_key")
    return k if isinstance(k, str) and re.fullmatch(KEY_PATTERN, k) else None


def _outcome(db, install, grant, raw, origin, actor_kid_id) -> Outcome:
    """Everything before the handler is change-free; handler failures roll back."""
    try:
        action = parse_action(raw)
        needs_approval = check_action(grant, action, origin, actor_kid_id)
        handler = HANDLERS.get(action.type)
        if handler is None:
            raise ValueError("unknown action")
    except (ValueError, Denied) as e:
        return "rejected", getattr(e, "reason", None) or str(e), {}
    try:
        return handler(db, install, grant, action, needs_approval)
    except (ValueError, Denied, HTTPException) as e:
        db.rollback()
        reason = e.detail if isinstance(e, HTTPException) else getattr(e, "reason", None)
        return "rejected", str(reason or e), {}


def apply_actions(
    db: Session,
    install: IntegrationInstall,
    raw: list[dict],
    origin: Origin = "service",
    actor_kid_id: int | None = None,
) -> list[ActionResult]:
    """Apply each action in order, committing one at a time. Duplicate keys apply once."""
    results = []
    for item in raw:
        item = item if isinstance(item, dict) else {}
        key = _key_of(item)
        if key and (row := audit.prior(db, install.id, key)):
            results.append(audit.as_result(row))
            continue
        key = key or f"invalid:{uuid4().hex}"
        grant = store.load_grant(db, install)
        result, reason, refs = _outcome(db, install, grant, item, origin, actor_kid_id)
        row = audit.record(db, install, str(item.get("type"))[:24], key, result, reason, **refs)
        try:
            db.commit()
        except IntegrityError:  # a concurrent duplicate won the key; its result stands
            db.rollback()
            row = audit.prior(db, install.id, key)
            if row is None:
                raise
        results.append(audit.as_result(row))
    return results
