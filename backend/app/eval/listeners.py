"""Box events from one SQLAlchemy after_flush listener (Decisions 3 and 4).

Reads only in-memory flush state (new/dirty/deleted and attribute history): no queries on
the flushing session, no writes to the main DB. Counters and events go to eval.db.
"""

import time

from sqlalchemy import event, inspect
from sqlalchemy.orm import Session

from app.eval import hooks, store
from app.eval.config import stats_on
from app.eval.events import duration_bucket, emit
from app.models.chat import ThreadMessage
from app.models.chores import Chore, ChoreRun
from app.models.family import FamilySettings
from app.models.hours import HourRule
from app.models.lock import Override

_STATUS = {"submitted": "chores_done", "done": "chores_approved", "skipped": "chores_skipped"}


def first_event(key: str) -> None:
    t0 = store.kv_get("wizard_done_at")
    if t0 is not None and store.once(key):
        emit(key, {"minutes": round((time.time() - float(t0)) / 60)})


def _new_value(obj, col: str):
    """The value `col` was set to in this flush, else None."""
    added = inspect(obj).attrs[col].history.added
    return added[0] if added else None


def _runs(objs) -> None:
    for o in objs:
        status = _new_value(o, "status")
        if status in _STATUS:
            store.bump(_STATUS[status])
        if status == "submitted":
            age = store.kid_age(o.submitted_by_id)
            emit("chore_done", {}, source="kid", age_group=age, url="/kid")
        elif status == "done":
            first_event("first_chore")


def _overrides(new) -> None:
    groups: set[tuple[str, int | None]] = set()
    for o in new:
        if isinstance(o, Override) and o.source == "manual":
            minutes = None
            if o.expires_at is not None and o.created_at is not None:
                minutes = round((o.expires_at - o.created_at).total_seconds() / 60)
            groups.add((o.action, minutes))
    for action, minutes in groups:
        store.bump(f"manual_{action}s")
        emit("override", {"action": action, "duration_bucket": duration_bucket(minutes)})


def _rule_off(session: Session) -> None:
    """A parent loosened the rules: deleted an online-hours rule, or turned the chore lock off."""
    kinds = ["hours" for o in session.deleted if isinstance(o, HourRule) and o.kind == "allowed"]
    for o in session.dirty:
        if isinstance(o, FamilySettings) and _new_value(o, "chores_lock") is False:
            kinds.append("chore_lock")
        elif isinstance(o, Chore):
            h = inspect(o).attrs.archived_at.history
            if h.added and h.added[0] is not None and not any(h.deleted):
                kinds.append("rule_deleted")
    kinds += ["rule_deleted" for o in session.deleted if isinstance(o, Chore)]
    for k in kinds:
        emit("rule_off", {"kind": k})


@hooks.safe
def on_flush(session: Session, ctx) -> None:
    if not stats_on():
        return
    new = list(session.new)
    runs = [o for o in new if isinstance(o, ChoreRun)]
    if runs:
        store.bump("chores_assigned", len(runs))
    _runs(runs + [o for o in session.dirty if isinstance(o, ChoreRun)])
    for m in new:
        if isinstance(m, ThreadMessage) and m.note_label and m.author_id:
            emit("chore_note", {}, source="kid", age_group=store.kid_age(m.author_id), url="/kid")
    _overrides(new)
    _rule_off(session)


def register() -> None:
    if not event.contains(Session, "after_flush", on_flush):
        event.listen(Session, "after_flush", on_flush)
