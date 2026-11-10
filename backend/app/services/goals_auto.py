"""Kid-facing goal helpers: auto-share, builtin goals, suggestions."""

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.family import FamilySettings, get_family
from app.models.goal import Goal, GoalAuto, GoalContribution
from app.models.user import User
from app.services import goals, inbox

JAIL_NAME = "Get out of jail free"


def builtin_name(fam: FamilySettings, kind: str) -> str:
    return f"{fam.goal_screen_minutes} min extra screen time" if kind == "screen" else JAIL_NAME


def _auto_target(db: Session, kid_id: int) -> Goal | None:
    pick = db.get(GoalAuto, kid_id)
    g = db.get(Goal, pick.goal_id) if pick else None
    if g and g.status == "active" and g.kid_id in (kid_id, None):
        return g
    return (
        db.query(Goal)
        .filter(Goal.kid_id == kid_id, Goal.status == "active")
        .order_by(Goal.created_at, Goal.id)
        .first()
    )


def auto_share(db: Session, kid_id: int, earned: int) -> None:
    """Move a slice of fresh earnings into the kid's goal. Flushes, never commits."""
    fam = get_family(db)
    if not (fam.goals_on and fam.goal_auto) or earned <= 0:
        return
    goal = _auto_target(db, kid_id)
    if goal is None:
        return
    n = min(earned * fam.goal_auto_pct // 100, goal.target - goals.saved(db, goal.id))
    if n <= 0:
        return
    goals._ledger(db, kid_id, -n, "goal_save", f"Saved to {goal.name}")
    db.add(GoalContribution(goal_id=goal.id, kid_id=kid_id, by_id=kid_id, amount=n, kind="auto"))
    db.flush()
    goals._check_full(db, goal)


def builtin_ok(fam: FamilySettings, kind: str) -> bool:
    if kind == "screen":
        return bool(fam.goal_screen_on and fam.points_unlock_early and fam.screen_rollover)
    return bool(kind == "jail" and fam.goal_jail_on)


def builtins(fam: FamilySettings) -> list[dict]:
    out = []
    if builtin_ok(fam, "screen"):
        out.append(
            {
                "kind": "screen",
                "name": builtin_name(fam, "screen"),
                "target": fam.goal_screen_price,
                "minutes": fam.goal_screen_minutes,
            }
        )
    if builtin_ok(fam, "jail"):
        out.append(
            {
                "kind": "jail",
                "name": JAIL_NAME,
                "target": fam.goal_jail_price,
                "minutes": None,
            }
        )
    return out


def _check_limit(db: Session, fam: FamilySettings, kid: User) -> None:
    n = goals.max_for(fam, kid)
    if goals.own_count(db, kid.id) >= n:
        raise HTTPException(409, f"You can have {n} goal{'s' if n > 1 else ''} at a time.")


def can_add(db: Session, fam: FamilySettings, kid: User) -> bool:
    return bool(
        fam.goals_on and fam.goal_suggest and goals.own_count(db, kid.id) < goals.max_for(fam, kid)
    )


def suggest(db: Session, kid: User, name: str) -> Goal:
    fam = get_family(db)
    if not (fam.goals_on and fam.goal_suggest):
        raise HTTPException(403, "A parent turned off goal ideas.")
    _check_limit(db, fam, kid)
    g = Goal(name=name, kind="custom", kid_id=kid.id, status="suggested", created_by_id=kid.id)
    db.add(g)
    db.flush()
    inbox.notify_parents(db, "goal_suggested", f"{kid.full_name or kid.username} suggests {name}")
    db.commit()
    return g


def start(db: Session, kid: User, kind: str) -> Goal:
    fam = get_family(db)
    if not (fam.goals_on and builtin_ok(fam, kind)):
        raise HTTPException(400, "That goal isn't available.")
    _check_limit(db, fam, kid)
    screen = kind == "screen"
    g = Goal(
        name=builtin_name(fam, kind),
        kind=kind,
        kid_id=kid.id,
        status="active",
        target=fam.goal_screen_price if screen else fam.goal_jail_price,
        minutes=fam.goal_screen_minutes if screen else None,
        created_by_id=kid.id,
        owner_id=fam.owner_id,
    )
    db.add(g)
    db.commit()
    return g
