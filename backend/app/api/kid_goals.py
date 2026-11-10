"""Kid API: my goals."""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.api.kid import require_kid, view_kid
from app.models.family import get_family
from app.models.goal import Goal, GoalAuto, GoalParty
from app.models.user import User
from app.services import economy, goals, goals_auto
from app.services.goals_out import goal_out

router = APIRouter(prefix="/api/v1/kid", tags=["kid"])


class SuggestIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)


class StartIn(BaseModel):
    kind: str = Field(pattern="^(screen|jail)$")


class AmountIn(BaseModel):
    amount: int = Field(gt=0)


def _mine(db: Session, kid: User, goal_id: int) -> Goal:
    g = db.get(Goal, goal_id)
    if not get_family(db).goals_on:
        raise HTTPException(403, "A parent turned off goals.")
    if g is None or g.kid_id not in (kid.id, None):
        raise HTTPException(404, "We couldn't find that goal.")
    return g


def _name(u: User | None) -> str | None:
    return (u.full_name or u.username) if u else None


@router.get("/goals")
def my_goals(db: Session = Depends(get_db), kid: User = Depends(view_kid)):
    fam = get_family(db)
    auto = db.get(GoalAuto, kid.id)
    out = {
        "on": bool(fam.goals_on),
        "suggest": bool(fam.goal_suggest),
        "withdraw": bool(fam.goal_withdraw),
        "auto": bool(fam.goal_auto),
        "auto_pct": fam.goal_auto_pct,
        "auto_goal_id": auto.goal_id if auto else None,
        "can_add": goals_auto.can_add(db, fam, kid),
        "free": economy.balance(db, kid.id) - economy.pending_cost(db, kid.id),
        "builtins": [],
        "goals": [],
        "done": [],
        "party": [],
    }
    if not fam.goals_on:
        return out
    mine = (Goal.kid_id == kid.id) | Goal.kid_id.is_(None)
    live = (
        db.query(Goal).filter(mine, Goal.status != "fulfilled").order_by(Goal.created_at, Goal.id)
    )
    done = (
        db.query(Goal)
        .filter(mine, Goal.status == "fulfilled")
        .order_by(Goal.fulfilled_at.desc(), Goal.id.desc())
        .limit(5)
    )
    out["builtins"] = goals_auto.builtins(fam)
    out["goals"] = [
        goal_out(db, g, kid, fam)
        for g in live
        if not (g.kid_id is None and g.status == "suggested")
    ]
    out["done"] = [goal_out(db, g, kid, fam) for g in done]
    parties = (
        db.query(GoalParty, Goal)
        .join(Goal, Goal.id == GoalParty.goal_id)
        .filter(GoalParty.kid_id == kid.id, GoalParty.seen_at.is_(None))
        .all()
    )
    out["party"] = [
        {"goal_id": g.id, "name": g.name, "by": _name(db.get(User, g.fulfilled_by_id))}
        for _, g in parties
    ]
    return out


@router.post("/goals/suggest")
def suggest(body: SuggestIn, db: Session = Depends(get_db), kid: User = Depends(require_kid)):
    g = goals_auto.suggest(db, kid, body.name.strip())
    return goal_out(db, g, kid, get_family(db))


@router.post("/goals/start")
def start(body: StartIn, db: Session = Depends(get_db), kid: User = Depends(require_kid)):
    g = goals_auto.start(db, kid, body.kind)
    return goal_out(db, g, kid, get_family(db))


@router.post("/goals/{goal_id}/add")
def add(
    goal_id: int, body: AmountIn, db: Session = Depends(get_db), kid: User = Depends(require_kid)
):
    g = _mine(db, kid, goal_id)
    goals.save(db, g, kid, body.amount)
    return goal_out(db, g, kid, get_family(db))


@router.post("/goals/{goal_id}/withdraw")
def withdraw(
    goal_id: int, body: AmountIn, db: Session = Depends(get_db), kid: User = Depends(require_kid)
):
    g = _mine(db, kid, goal_id)
    goals.withdraw(db, g, kid, body.amount)
    return goal_out(db, g, kid, get_family(db))


@router.post("/goals/{goal_id}/auto", status_code=204)
def choose_auto(goal_id: int, db: Session = Depends(get_db), kid: User = Depends(require_kid)):
    g = _mine(db, kid, goal_id)
    if g.status != "active":
        raise HTTPException(409, "This goal can't take points right now.")
    row = db.get(GoalAuto, kid.id)
    if row:
        row.goal_id = g.id
    else:
        db.add(GoalAuto(kid_id=kid.id, goal_id=g.id))
    db.commit()
    return Response(status_code=204)


@router.delete("/goals/{goal_id}", status_code=204)
def remove(goal_id: int, db: Session = Depends(get_db), kid: User = Depends(require_kid)):
    g = _mine(db, kid, goal_id)
    if g.kid_id is None:
        raise HTTPException(409, "Points in a family goal stay there.")
    if g.status == "full":
        raise HTTPException(409, "Goals that are full stay put until a parent says it's done.")
    if g.status == "fulfilled":
        raise HTTPException(409, "This goal is already done.")
    if not get_family(db).goal_withdraw and goals.saved(db, g.id) > 0:
        raise HTTPException(409, "A parent turned off taking points back.")
    goals.delete(db, g)
    return Response(status_code=204)


@router.post("/goals/{goal_id}/party-seen", status_code=204)
def party_seen(goal_id: int, db: Session = Depends(get_db), kid: User = Depends(require_kid)):
    row = db.get(GoalParty, (goal_id, kid.id))
    if row is None:
        raise HTTPException(404, "We couldn't find that party.")
    row.seen_at = datetime.utcnow()
    db.commit()
    return Response(status_code=204)
