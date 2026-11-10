"""Parent API: goals."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_parent
from app.models.family import get_family
from app.models.goal import Goal
from app.models.user import User, UserRole
from app.services import economy, goals, goals_out

router = APIRouter(prefix="/api/v1/goals", tags=["goals"], dependencies=[Depends(require_parent)])

Name = Annotated[str, Field(min_length=1, max_length=60)]
Points = Annotated[int, Field(ge=1, le=100000)]


class GoalCreate(BaseModel):
    name: Name | None = None
    emoji: str | None = Field(default=None, max_length=16)
    target: Points | None = None
    kind: Literal["custom", "screen", "jail"] = "custom"
    kid_ids: list[int] = []
    family: bool = False


class GoalPatch(BaseModel):
    name: Name | None = None
    emoji: str | None = Field(default=None, max_length=16)
    target: Points | None = None


class PriceIn(BaseModel):
    target: Points


class ChipIn(BaseModel):
    amount: int = Field(ge=1, le=100000)


class SettingsPatch(BaseModel):
    on: bool | None = None
    suggest: bool | None = None
    withdraw: bool | None = None
    siblings: bool | None = None
    auto: bool | None = None
    auto_pct: int | None = Field(default=None, ge=5, le=100)
    max_little: int | None = Field(default=None, ge=1, le=10)
    max_kid: int | None = Field(default=None, ge=1, le=10)
    max_teen: int | None = Field(default=None, ge=1, le=10)
    screen_on: bool | None = None
    screen_price: Points | None = None
    screen_minutes: int | None = Field(default=None, ge=15, le=240)
    jail_on: bool | None = None
    jail_price: Points | None = None

    @field_validator("auto_pct", "screen_minutes")
    @classmethod
    def _step(cls, v, info):
        if v is not None and v % (5 if info.field_name == "auto_pct" else 15):
            raise ValueError("bad step")
        return v


def _get(db: Session, goal_id: int) -> Goal:
    g = db.get(Goal, goal_id)
    if g is None:
        raise HTTPException(404, "Goal not found")
    return g


@router.get("/settings")
def get_settings(db: Session = Depends(get_db)):
    return goals_out.settings_out(db, get_family(db))


@router.patch("/settings")
def patch_settings(body: SettingsPatch, db: Session = Depends(get_db)):
    fam = get_family(db)
    for key in body.model_fields_set:
        v = getattr(body, key)
        if v is not None:
            setattr(fam, goals_out.SETTING_KEYS[key], v)
    db.commit()
    return goals_out.settings_out(db, fam)


@router.get("")
def list_goals(parent: User = Depends(require_parent), db: Session = Depends(get_db)):
    fam = get_family(db)

    def out(rows):
        return [goals_out.goal_out(db, g, parent, fam) for g in rows]

    q = db.query(Goal)
    return {
        "settings": goals_out.settings_out(db, fam),
        "waiting": out(
            q.filter(Goal.status.in_(("full", "suggested"))).order_by(Goal.created_at, Goal.id)
        ),
        "family": out(q.filter(Goal.kid_id.is_(None), Goal.status == "active").order_by(Goal.id)),
        "kids": out(q.filter(Goal.kid_id.isnot(None), Goal.status == "active").order_by(Goal.id)),
        "done": out(
            q.filter(Goal.status == "fulfilled").order_by(Goal.fulfilled_at.desc()).limit(10)
        ),
    }


@router.post("")
def create_goal(
    body: GoalCreate, parent: User = Depends(require_parent), db: Session = Depends(get_db)
):
    fam = get_family(db)
    name, target, minutes = body.name, body.target, None
    if body.kind != "custom":
        if body.family:
            raise HTTPException(400, "Family goals must be custom.")
        if body.kind == "screen":
            if not (fam.goal_screen_on and goals_out.settings_out(db, fam)["screen_ok"]):
                raise HTTPException(400, "Extra screen time goals are off.")
            minutes, target = fam.goal_screen_minutes, fam.goal_screen_price
            name = f"{minutes} min extra screen time"
        else:
            if not fam.goal_jail_on:
                raise HTTPException(400, "Get out of jail free goals are off.")
            target = fam.goal_jail_price
            name = "Get out of jail free"
    elif name is None or target is None:
        raise HTTPException(400, "A goal needs a name and a target.")
    if body.family:
        kid_ids: list[int | None] = [None]
    else:
        kid_ids = list(dict.fromkeys(body.kid_ids))
        if not kid_ids:
            raise HTTPException(400, "Pick at least one kid or make it a family goal.")
        kids = db.query(User).filter(User.id.in_(kid_ids), User.role == UserRole.KID).count()
        if kids != len(kid_ids):
            raise HTTPException(400, "Unknown kid.")
    made = [
        Goal(
            name=name,
            emoji=body.emoji,
            kind=body.kind,
            kid_id=kid_id,
            target=target,
            minutes=minutes,
            status="active",
            created_by_id=parent.id,
        )
        for kid_id in kid_ids
    ]
    db.add_all(made)
    db.commit()
    return [goals_out.goal_out(db, g, parent, fam) for g in made]


@router.patch("/{goal_id}")
def patch_goal(
    goal_id: int,
    body: GoalPatch,
    parent: User = Depends(require_parent),
    db: Session = Depends(get_db),
):
    with economy.SPEND_LOCK:
        g = _get(db, goal_id)
        if g.status in ("suggested", "fulfilled"):
            raise HTTPException(409, "This goal can't be edited right now.")
        if body.name is not None:
            g.name = body.name
        if "emoji" in body.model_fields_set:
            g.emoji = body.emoji
        if body.target is not None:
            goals.set_target(db, g, body.target)
        db.commit()
    return goals_out.goal_out(db, g, parent, get_family(db))


@router.delete("/{goal_id}", status_code=204)
def delete_goal(goal_id: int, db: Session = Depends(get_db)):
    g = _get(db, goal_id)
    if g.status == "fulfilled":
        raise HTTPException(409, "This goal is already done.")
    goals.delete(db, g)
    return Response(status_code=204)


@router.post("/{goal_id}/price")
def price_goal(
    goal_id: int,
    body: PriceIn,
    parent: User = Depends(require_parent),
    db: Session = Depends(get_db),
):
    g = _get(db, goal_id)
    if g.status != "suggested":
        raise HTTPException(409, "This goal already has a price.")
    g.target, g.status, g.owner_id = body.target, "active", parent.id
    db.commit()
    return goals_out.goal_out(db, g, parent, get_family(db))


@router.post("/{goal_id}/decline", status_code=204)
def decline_goal(goal_id: int, db: Session = Depends(get_db)):
    g = _get(db, goal_id)
    if g.status != "suggested":
        raise HTTPException(409, "Only suggestions can be declined.")
    db.delete(g)
    db.commit()
    return Response(status_code=204)


@router.post("/{goal_id}/fulfill")
def fulfill_goal(
    goal_id: int, parent: User = Depends(require_parent), db: Session = Depends(get_db)
):
    g = _get(db, goal_id)
    goals.fulfill(db, g, parent)
    return goals_out.goal_out(db, g, parent, get_family(db))


@router.post("/{goal_id}/chip-in")
def chip_in(
    goal_id: int,
    body: ChipIn,
    parent: User = Depends(require_parent),
    db: Session = Depends(get_db),
):
    g = _get(db, goal_id)
    if g.kid_id is not None:
        raise HTTPException(400, "Only family goals take chip-ins.")
    goals.chip_in(db, g, parent, body.amount)
    return goals_out.goal_out(db, g, parent, get_family(db))
