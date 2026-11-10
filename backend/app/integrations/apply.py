"""Apply integration actions: grant check, idempotent audit, then the handler."""

import logging
import re
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.integrations import audit, store
from app.integrations.audit import ActionResult
from app.integrations.permissions import Denied, Grant, Origin, check_action
from app.integrations.protocol import CTRL, KEY_PATTERN, Action, parse_action
from app.models.chores import Chore, ChoreAssignment, ChoreRun
from app.models.integration import IntegrationAction, IntegrationInstall
from app.models.reward import Redemption, Reward
from app.models.user import User
from app.services import chore_actions, economy, inbox
from app.services import chores as svc
from app.services.chat_extras import first_name

log = logging.getLogger(__name__)

Outcome = tuple[str, str | None, dict]  # result, reason, audit refs
Handler = Callable[[Session, IntegrationInstall, Grant, Action, bool], Outcome]


def _todays_run(db: Session, a: Action, now: datetime) -> ChoreRun | None:
    return (
        db.query(ChoreRun)
        .join(ChoreAssignment, ChoreRun.assignment_id == ChoreAssignment.id)
        .filter(
            ChoreAssignment.chore_id == a.chore_id,
            ChoreRun.day == svc.today(db, now.replace(tzinfo=UTC)),
            svc.kid_runs_filter(a.kid_id),
        )
        .first()
    )


def _chore_complete(
    db: Session, install: IntegrationInstall, grant: Grant, a: Action, needs_approval: bool
) -> Outcome:
    now = datetime.now(UTC).replace(tzinfo=None)
    refs = {"kid_id": a.kid_id, "chore_id": a.chore_id, "created_at": now}
    run = _todays_run(db, a, now)
    if run is None or run.status != "todo" or not chore_actions.claim(db, run):
        return "rejected", "nothing to do today", refs
    refs["run_id"] = run.id
    # Ruling: an integration completion skips the photo requirement. The signal is the proof.
    chore_actions.tick_all(run, a.kid_id, now)
    chore_actions.submit(run, a.kid_id, now)
    if needs_approval:
        kid = db.get(User, a.kid_id)
        inbox.notify_parents(
            db,
            "integration_done",
            f"{grant.name}: {first_name(kid)} finished {svc.chore_of(run).title}",
            "Take a look and approve it.",
            run_id=run.id,
        )
        from app.integrations import events  # events imports this module

        events.emit(
            db,
            "request.created",
            [a.kid_id],
            chore_id=a.chore_id,
            skip_install_id=install.id,
            type="chore",
            id=run.id,
            title=svc.chore_of(run).title,
        )
        return "pending", None, refs
    chore_actions.approve(db, run, None, via="integration")
    return "applied", None, refs


MAX_REWARDS = 50
MAX_MESSAGES_PER_DAY = 20


def _reward_upsert(db, install, grant, a, needs_approval) -> Outcome:
    r = db.query(Reward).filter_by(integration_install_id=install.id, integration_ref=a.ref).first()
    if r is None:
        n = db.query(Reward).filter_by(integration_install_id=install.id, active=True).count()
        if n >= MAX_REWARDS:
            return "rejected", "too many rewards", {}
        db.add(
            Reward(
                name=a.name,
                price=a.price,
                icon=a.icon,
                needs_approval=True,
                visible=True,
                integration_install_id=install.id,
                integration_ref=a.ref,
            )
        )
    elif not r.active:
        return "rejected", "a parent removed this reward", {}
    elif (r.name, r.price, r.icon) != (a.name, a.price, a.icon):
        # What a parent sees must be what they approve: no edits mid-request.
        pending = db.query(Redemption).filter_by(reward_id=r.id, status="pending").count()
        if pending:
            return "rejected", "has pending requests", {}
        r.name, r.price, r.icon = a.name, a.price, a.icon
    return "applied", None, {}


def _reward_remove(db, install, grant, a, needs_approval) -> Outcome:
    r = (
        db.query(Reward)
        .filter_by(integration_install_id=install.id, integration_ref=a.ref, active=True)
        .first()
    )
    if r is None:
        return "rejected", "no such reward", {}
    economy.deactivate_reward(r)
    r.integration_ref = None  # frees the ref for a fresh reward
    return "applied", None, {}


def _message_parents(db, install, grant, a, needs_approval) -> Outcome:
    since = datetime.now(UTC).replace(tzinfo=None) - timedelta(hours=24)
    sent = (
        db.query(IntegrationAction)
        .filter(
            IntegrationAction.install_id == install.id,
            IntegrationAction.kind == "message.parents",
            IntegrationAction.result == "applied",
            IntegrationAction.created_at >= since,
        )
        .count()
    )
    if sent >= MAX_MESSAGES_PER_DAY:
        return "rejected", "too many messages today", {}
    title = CTRL.sub("", f"{install.name}: {a.title}".replace("\n", " "))[:120]
    body = CTRL.sub("", a.body) if a.body else None
    inbox.notify_parents(db, "integration_msg", title, body)
    return "applied", None, {}


def _decide_reward(db, install, grant, a) -> Outcome:
    r = db.get(Redemption, a.id)
    if r is None or r.kid_id not in grant.kid_ids:
        return "rejected", "not found", {}
    refs = {"redemption_id": r.id, "kid_id": r.kid_id}
    # Anti-goal: screen time (and anything else that unlocks a device) needs the app.
    if r.kind != "reward":
        return "rejected", "only the t@sk4ce app can answer this", refs
    if r.status != "pending":
        return "rejected", "already answered", refs
    try:
        economy.decide(db, r, None, a.approve, a.note)
    except HTTPException as e:
        db.refresh(r)  # a parent may have answered after we loaded it
        return "rejected", "already answered" if r.status != "pending" else str(e.detail), refs
    r.auto = False  # economy marks parent-less decisions automatic; this one is the parent's
    db.commit()
    return "applied", None, refs


def _claim_decision(db: Session, run: ChoreRun, status: str) -> bool:
    """Compare-and-set submitted -> status, so two deciders cannot both act."""
    n = (
        db.query(ChoreRun)
        .filter(ChoreRun.id == run.id, ChoreRun.status == "submitted")
        .update({"status": status}, synchronize_session=False)
    )
    return n == 1


def _decide_chore(db, install, grant, a) -> Outcome:
    run = db.get(ChoreRun, a.id)
    kids = [k for k in svc.run_kid_ids(run) if k in grant.kid_ids] if run else []
    if not kids or svc.chore_of(run).id not in grant.chore_ids:
        return "rejected", "not found", {}
    refs = {"run_id": run.id, "kid_id": kids[0], "chore_id": svc.chore_of(run).id}
    if run.status != "submitted" or not _claim_decision(db, run, "done" if a.approve else "todo"):
        return "rejected", "already answered", refs
    if a.approve:
        chore_actions.approve(db, run, None, via="integration")
    else:
        chore_actions.send_back(db, run, a.note or f"Sent back by {install.name}")
    return "applied", None, refs


def _request_decide(db, install, grant, a, needs_approval) -> Outcome:
    """The parent acting through the integration: not gated by the trust switch.
    Only reward redemptions and chore check-offs; the target vocabulary is closed."""
    return (_decide_reward if a.target == "reward" else _decide_chore)(db, install, grant, a)


HANDLERS: dict[str, Handler] = {
    "chore.complete": _chore_complete,
    "reward.upsert": _reward_upsert,
    "reward.remove": _reward_remove,
    "message.parents": _message_parents,
    "request.decide": _request_decide,
}


def _key_of(raw: dict) -> str | None:
    k = raw.get("idempotency_key")
    return k if isinstance(k, str) and re.fullmatch(KEY_PATTERN, k) else None


def _refs_of(db: Session, action: Action | None) -> dict:
    """The action's kid and chore, when they parsed and exist (the audit FKs stay valid)."""
    kid_id, chore_id = getattr(action, "kid_id", None), getattr(action, "chore_id", None)
    return {
        "kid_id": kid_id if kid_id is not None and db.get(User, kid_id) else None,
        "chore_id": chore_id if chore_id is not None and db.get(Chore, chore_id) else None,
    }


def _commits_itself(action: Action) -> bool:
    """economy.decide commits under its spend lock, so it cannot run in a savepoint."""
    return action.type == "request.decide" and action.target == "reward"


def _outcome(db, install, grant, raw, origin, actor_kid_id) -> Outcome:
    """Checks are change-free. The handler runs in a savepoint, so a failure undoes only
    its own writes, never the caller's pending work or earlier actions. A reward decision
    commits itself instead (see _commits_itself)."""
    action = None
    try:
        action = parse_action(raw)
        needs_approval = check_action(grant, action, origin, actor_kid_id)
        handler = HANDLERS.get(action.type)
        if handler is None:
            raise ValueError("unknown action")
        if _commits_itself(action):
            db.commit()  # settle the audit claim; the handler then owns the transaction
            try:
                return handler(db, install, grant, action, needs_approval)
            except Exception:
                db.rollback()
                raise
        with db.begin_nested():
            return handler(db, install, grant, action, needs_approval)
    except HTTPException as e:
        return "rejected", str(e.detail), _refs_of(db, action)
    except Denied as e:
        return "rejected", e.reason, _refs_of(db, action)
    except ValueError as e:
        return "rejected", str(e), _refs_of(db, action)
    except Exception:
        log.exception("integration %s: action handler failed", install.id)
        return "rejected", "internal error", _refs_of(db, action)


def apply_actions(
    db: Session,
    install: IntegrationInstall,
    raw: list[dict],
    origin: Origin = "service",
    actor_kid_id: int | None = None,
) -> list[ActionResult]:
    """Apply each action in order, committing one at a time. Duplicate keys apply once.

    The audit row is inserted first: it claims the key (a concurrent duplicate fails there,
    before its handler runs) and opens the transaction. Each handler then runs in a
    savepoint, so a failing action rolls back only its own writes."""
    results = []
    for item in raw:
        item = item if isinstance(item, dict) else {}
        key = _key_of(item)
        if key and (row := audit.prior(db, install.id, key)):
            results.append(audit.as_result(row))
            continue
        key = key or f"invalid:{uuid4().hex}"
        row = audit.record(db, install, str(item.get("type")), key, "rejected", "internal error")
        try:
            db.flush()
        except IntegrityError:  # a concurrent duplicate won the key; its result stands
            db.rollback()
            row = audit.prior(db, install.id, key)
            if row is None:
                raise
            results.append(audit.as_result(row))
            continue
        grant = store.load_grant(db, install)
        result, reason, refs = _outcome(db, install, grant, item, origin, actor_kid_id)
        audit.settle(row, result, reason, **refs)
        db.commit()
        results.append(audit.as_result(row))
    return results
