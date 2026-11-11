"""Savings goals: all point movement, under economy.SPEND_LOCK.

Saved amount is SUM(goal_contributions.amount). Kid points move through the
Points ledger (TRANSFER, so no XP); parent chip-ins and penalty takes don't.
"""

from datetime import datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.family import FamilySettings, get_family
from app.models.goal import Goal, GoalContribution, GoalParty
from app.models.lock import Override
from app.models.points import Points, PointsType
from app.models.user import User, UserRole
from app.services import economy, inbox


def saved(db: Session, goal_id: int) -> int:
    q = db.query(func.coalesce(func.sum(GoalContribution.amount), 0))
    return int(q.filter(GoalContribution.goal_id == goal_id).scalar())


def given(db: Session, goal_id: int, kid_id: int) -> int:
    q = db.query(func.coalesce(func.sum(GoalContribution.amount), 0))
    return int(
        q.filter(GoalContribution.goal_id == goal_id, GoalContribution.kid_id == kid_id).scalar()
    )


def max_for(fam: FamilySettings, kid: User) -> int:
    return {"little": fam.goal_max_little, "teen": fam.goal_max_teen}.get(
        kid.age_group, fam.goal_max_kid
    )


def own_count(db: Session, kid_id: int) -> int:
    return (
        db.query(Goal)
        .filter(Goal.kid_id == kid_id, Goal.status.in_(("suggested", "active", "full")))
        .count()
    )


def _ledger(db: Session, kid_id: int, amount: int, reason: str, note: str) -> None:
    db.add(
        Points(
            user_id=kid_id,
            points_type=PointsType.TRANSFER,
            amount=amount,
            reason=reason,
            description=note,
            seen_by_kid=True,
        )
    )


def save(db: Session, goal: Goal, kid: User, amount: int, kind: str = "save") -> int:
    """Move up to `amount` (capped at what's left) from the kid into the goal. Commits."""
    with economy.SPEND_LOCK:
        db.commit()  # fresh snapshot: see other threads' debits
        db.refresh(goal)
        if goal.status != "active":
            raise HTTPException(409, "This goal can't take points right now.")
        spare = economy.balance(db, kid.id) - economy.pending_cost(db, kid.id)
        if amount > spare:
            raise HTTPException(409, f"You have {max(spare, 0)} points to spare.")
        n = min(amount, goal.target - saved(db, goal.id))
        if n > 0:
            _ledger(db, kid.id, -n, "goal_save", f"Saved to {goal.name}")
            db.add(
                GoalContribution(goal_id=goal.id, kid_id=kid.id, by_id=kid.id, amount=n, kind=kind)
            )
            db.flush()
            _check_full(db, goal)
        db.commit()
        return max(n, 0)


def withdraw(db: Session, goal: Goal, kid: User, amount: int) -> int:
    """Take the kid's own points back out of a goal. Commits."""
    with economy.SPEND_LOCK:
        db.commit()
        db.refresh(goal)
        if goal.kid_id is None:
            raise HTTPException(409, "Points in a family goal stay there.")
        if goal.status == "full":
            raise HTTPException(409, "Goals that are full stay put until a parent says it's done.")
        if not get_family(db).goal_withdraw:
            raise HTTPException(409, "A parent turned off taking points back.")
        have = given(db, goal.id, kid.id)
        if amount > have:
            raise HTTPException(409, f"You put {have} points in this goal.")
        _ledger(db, kid.id, amount, "goal_return", f"Took back from {goal.name}")
        db.add(
            GoalContribution(
                goal_id=goal.id, kid_id=kid.id, by_id=kid.id, amount=-amount, kind="return"
            )
        )
        db.commit()
        return amount


def chip_in(db: Session, goal: Goal, parent: User, amount: int) -> int:
    """A parent adds points to a family goal (no ledger row). Commits."""
    with economy.SPEND_LOCK:
        db.commit()
        db.refresh(goal)
        if goal.kid_id is not None:
            raise HTTPException(409, "Only family goals take chip-ins.")
        if goal.status != "active":
            raise HTTPException(409, "This goal can't take points right now.")
        db.add(GoalContribution(goal_id=goal.id, by_id=parent.id, amount=amount, kind="chip_in"))
        db.flush()
        _check_full(db, goal)
        db.commit()
        return amount


def refund_all(db: Session, goal: Goal) -> None:
    """Give every kid back their own net amount. Flushes only."""
    rows = (
        db.query(GoalContribution.kid_id, func.sum(GoalContribution.amount))
        .filter(GoalContribution.goal_id == goal.id, GoalContribution.kid_id.isnot(None))
        .group_by(GoalContribution.kid_id)
        .all()
    )
    for kid_id, net in rows:
        if net and net > 0:
            _ledger(db, kid_id, int(net), "goal_return", f"{goal.name} was removed")
    db.flush()


def delete(db: Session, goal: Goal) -> None:
    with economy.SPEND_LOCK:
        db.commit()
        refund_all(db, goal)
        db.delete(goal)
        db.commit()


def _who(db: Session, goal: Goal) -> str:
    kid = db.get(User, goal.kid_id) if goal.kid_id else None
    return (kid.full_name or kid.username) if kid else "The family"


def _check_full(db: Session, goal: Goal) -> None:
    """Flip active <-> full as saved crosses the target. Flushes; caller commits."""
    if goal.target is None:
        return
    total = saved(db, goal.id)
    if goal.status == "active" and total >= goal.target:
        goal.status = "full"
        goal.reached_at = datetime.utcnow()
        inbox.notify_parents(db, "goal_full", f"{_who(db, goal)}'s {goal.name} is full")
    elif goal.status == "full" and total < goal.target:
        goal.status = "active"
        goal.reached_at = None
    db.flush()


def set_target(db: Session, goal: Goal, target: int) -> None:
    goal.target = target
    db.flush()
    _check_full(db, goal)


def grant_screen(db: Session, kid_id: int, minutes: int, parent_id: int | None = None) -> None:
    """Free minutes now: a timed unlock on all the kid's devices (source "bonus", like a
    bought screen-time unlock). Caller commits."""
    now = datetime.utcnow()
    expires = now + timedelta(minutes=minutes)
    for dev in db.get(User, kid_id).devices:
        db.add(
            Override(
                device_id=dev.id,
                action="unlock",
                source="bonus",
                expires_at=expires,
                created_at=now,
                created_by_id=parent_id,
            )
        )


def fulfill(db: Session, goal: Goal, parent: User) -> None:
    with economy.SPEND_LOCK:
        db.commit()
        db.refresh(goal)
        if goal.status != "full":
            raise HTTPException(409, "This goal isn't full yet.")
        goal.status = "fulfilled"
        goal.fulfilled_by_id = parent.id
        goal.fulfilled_at = datetime.utcnow()
        if goal.kid_id:
            kids = [goal.kid_id]
        else:
            kids = [
                i for (i,) in db.query(User.id).filter(User.role == UserRole.KID, User.is_active)
            ]
        for kid_id in kids:
            db.add(GoalParty(goal_id=goal.id, kid_id=kid_id))
        if goal.kind == "screen" and goal.kid_id:
            grant_screen(db, goal.kid_id, goal.minutes or 0, parent.id)
        db.commit()


def waiting_on(db: Session, goal: Goal) -> str | None:
    owner_id = goal.owner_id or get_family(db).owner_id
    owner = db.get(User, owner_id) if owner_id else None
    return (owner.full_name or owner.username) if owner else None
