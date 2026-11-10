"""Serializers for goals (GoalOut, GoalSettings, NeedsItem)."""

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.family import FamilySettings
from app.models.goal import Goal, GoalContribution
from app.models.user import User, UserRole
from app.schemas.lock import utc_z
from app.services import goals

SETTING_KEYS = {
    "on": "goals_on",
    "suggest": "goal_suggest",
    "withdraw": "goal_withdraw",
    "siblings": "goal_siblings",
    "auto": "goal_auto",
    "auto_pct": "goal_auto_pct",
    "max_little": "goal_max_little",
    "max_kid": "goal_max_kid",
    "max_teen": "goal_max_teen",
    "screen_on": "goal_screen_on",
    "screen_price": "goal_screen_price",
    "screen_minutes": "goal_screen_minutes",
    "jail_on": "goal_jail_on",
    "jail_price": "goal_jail_price",
}


def settings_out(db: Session, fam: FamilySettings) -> dict:
    out = {k: getattr(fam, col) for k, col in SETTING_KEYS.items()}
    out["screen_ok"] = bool(fam.points_unlock_early and fam.screen_rollover)
    return out


def _name(u: User | None) -> str | None:
    return (u.full_name or u.username) if u else None


def _siblings(db: Session, goal: Goal) -> list[dict]:
    rows = (
        db.query(User, func.sum(GoalContribution.amount))
        .join(GoalContribution, GoalContribution.kid_id == User.id)
        .filter(GoalContribution.goal_id == goal.id)
        .group_by(User.id)
        .order_by(User.id)
        .all()
    )
    return [{"name": _name(u), "amount": int(n)} for u, n in rows if n and n > 0]


def goal_out(db: Session, goal: Goal, viewer: User, fam: FamilySettings) -> dict:
    kid_viewer = viewer.role == UserRole.KID
    kid = db.get(User, goal.kid_id) if goal.kid_id else None
    return {
        "id": goal.id,
        "name": goal.name,
        "emoji": goal.emoji,
        "kind": goal.kind,
        "family": goal.kid_id is None,
        "kid_id": goal.kid_id,
        "kid_name": _name(kid),
        "target": goal.target,
        "saved": goals.saved(db, goal.id),
        "minutes": goal.minutes,
        "status": goal.status,
        "waiting_on": goals.waiting_on(db, goal) if goal.status in ("suggested", "full") else None,
        "mine": goals.given(db, goal.id, viewer.id) if kid_viewer else 0,
        "siblings": _siblings(db, goal) if (not kid_viewer or fam.goal_siblings) else None,
        "created_at": utc_z(goal.created_at),
        "fulfilled_at": utc_z(goal.fulfilled_at),
    }


def needs(db: Session, names: dict[int, str]) -> list[dict]:
    rows = db.query(Goal).filter(Goal.status.in_(("full", "suggested"))).all()
    return [
        {
            "type": f"goal_{g.status}",
            "id": g.id,
            "kid_id": g.kid_id,
            "kid_name": names.get(g.kid_id),
            "title": g.name,
            "cost": g.target,
            "submitted_at": utc_z(g.reached_at if g.status == "full" else g.created_at),
        }
        for g in rows
    ]
