"""Penalties hook: a family-wide penalty can take points from a family goal or raise its target."""

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.goal import Goal, GoalContribution
from app.models.user import User
from app.services import economy, goals


def _family_goal(db: Session, goal_id: int) -> Goal:
    g = db.get(Goal, goal_id)
    if g is None:
        raise HTTPException(404, "We couldn't find that goal.")
    if g.kid_id is not None or g.status not in ("active", "full"):
        raise HTTPException(409, "Pick a family goal that is still being saved for.")
    return g


def take(db: Session, goal_id: int, parent: User, amount: int, reason: str | None) -> Goal:
    """Remove up to `amount` saved points (never below 0), noting why. Commits."""
    with economy.SPEND_LOCK:
        db.commit()  # fresh snapshot of the saved total
        goal = _family_goal(db, goal_id)
        n = min(amount, goals.saved(db, goal.id))
        if n <= 0:
            raise HTTPException(409, "That goal has nothing saved to take.")
        db.add(
            GoalContribution(
                goal_id=goal.id, by_id=parent.id, amount=-n, kind="take", note=reason or "Penalty"
            )
        )
        db.flush()
        goals._check_full(db, goal)  # a full goal that drops under its price opens again
        db.commit()
        return goal


def raise_target(db: Session, goal_id: int, amount: int) -> Goal:
    """Raise the price by `amount`; a full goal that is no longer full goes back to active. Commits."""
    with economy.SPEND_LOCK:
        db.commit()
        goal = _family_goal(db, goal_id)
        goals.set_target(db, goal, goal.target + amount)
        db.commit()
        return goal
