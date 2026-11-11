"""Trust mode: per-kid levels decide whether a finished chore approves itself."""

import random
from collections.abc import Callable
from typing import Literal

from sqlalchemy.orm import Session

from app.models.chores import ChoreRun
from app.models.trust import TrustEvent
from app.models.user import User
from app.services import economy, inbox

SPOT = {1: 5, 2: 20}  # level -> 1 in N finished chores stays waiting
UP_AT = {0: 10, 1: 30}  # level -> clean chores needed to move up
LEVELS = ("New", "Trusted", "Proven")
SELF_APPROVED = ("trust", "bedtime")  # approved_via values: no parent looked at it


def payees(run: ChoreRun) -> list[int]:
    """Kids paid for the run (same rule as approval points)."""
    return economy._recipients(run)


def was_caught(db: Session, run_id: int) -> bool:
    """A catch is on record for this run, so its redo always waits for a parent (owner ruling)."""
    return db.query(TrustEvent.id).filter_by(run_id=run_id, kind="catch").first() is not None


def decide(
    db: Session, run: ChoreRun, kid_ids: list[int], rng: Callable[[], float] = random.random
) -> Literal["auto", "spot", "wait"]:
    """Whether a submitted run approves itself. One roll per run; lowest level rules."""
    kids = [db.get(User, k) for k in kid_ids]
    chore = run.assignment.chore
    if chore.always_check or chore.makeup or not kids or not all(k.trust_mode for k in kids):
        return "wait"
    if was_caught(db, run.id):
        return "wait"
    lowest = min(k.trust_level for k in kids)
    if lowest == 0:
        return "wait"
    return "spot" if rng() < 1 / SPOT[lowest] else "auto"


def _event(db: Session, kid_id: int, kind: str, run_id=None, by_id=None) -> None:
    db.add(TrustEvent(kid_id=kid_id, kind=kind, run_id=run_id, by_id=by_id))


def _move(db: Session, kid: User, level: int, kind: str, run_id=None, by_id=None) -> None:
    kid.trust_level, kid.trust_clean = level, 0
    _event(db, kid.id, kind, run_id, by_id)


def _tell_up(db: Session, kid: User) -> None:
    name, level = kid.full_name or kid.username, LEVELS[kid.trust_level]
    inbox.notify(db, [kid.id], "trust_up", f"You're now {level}!")
    inbox.notify_parents(
        db,
        "trust_up",
        f"{name} is now {level}. Most chores will approve themselves, with spot checks.",
    )


def _tell_down(db: Session, kid: User) -> None:
    msg = f"Your trust level went back to {LEVELS[kid.trust_level]}. "
    inbox.notify(db, [kid.id], "trust_down", msg + "Keep going and you'll earn it back.")


def count_clean(db: Session, kid_ids: list[int]) -> None:
    """A chore was approved: bump each trust-mode kid's clean count, promoting at UP_AT."""
    for kid_id in kid_ids:
        kid = db.get(User, kid_id)
        if not kid or not kid.trust_mode:
            continue
        kid.trust_clean += 1
        if kid.trust_level in UP_AT and kid.trust_clean >= UP_AT[kid.trust_level]:
            _move(db, kid, kid.trust_level + 1, "up")
            _tell_up(db, kid)


def catch(db: Session, run: ChoreRun, kid_ids: list[int], by_id: int, lower: bool) -> None:
    """A self-approved or spot-checked chore wasn't done. Always resets the count."""
    for kid_id in kid_ids:
        kid = db.get(User, kid_id)
        if not kid or not kid.trust_mode:  # trust off: nothing to lose or reset
            continue
        _event(db, kid.id, "catch", run.id, by_id)
        kid.trust_clean = 0
        if lower and kid.trust_level > 0:
            _move(db, kid, kid.trust_level - 1, "down", run.id, by_id)
            _tell_down(db, kid)


def catch_run(db: Session, run: ChoreRun, by_id: int | None, lower: bool) -> None:
    """Catch every payee: only the submitter drops a level (everyone if none is recorded)."""
    who = payees(run)
    sub = run.submitted_by_id
    if sub in who:
        catch(db, run, [sub], by_id, lower)
        catch(db, run, [k for k in who if k != sub], by_id, lower=False)
    else:
        catch(db, run, who, by_id, lower)


def set_level(db: Session, kid: User, level: int, by_id: int) -> None:
    """A parent sets the level by hand."""
    _move(db, kid, level, "up" if level > kid.trust_level else "down", by_id=by_id)


def badge(kid: User) -> dict | None:
    """What the kid sees: level, chores to the next one and that level's goal (None at Proven). Off = None."""
    if not kid.trust_mode:
        return None
    need = UP_AT.get(kid.trust_level)
    return {
        "level": kid.trust_level,
        "to_next": None if need is None else max(need - kid.trust_clean, 0),
        "goal": need,  # chores needed for the next level, so the UI never copies UP_AT
    }
