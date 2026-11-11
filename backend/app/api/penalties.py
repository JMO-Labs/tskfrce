"""Parent API: give, list and adjust penalties."""

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_db, require_parent
from app.lock.loop import trigger
from app.models.chores import ChoreRun
from app.models.family import get_family
from app.models.goal import Goal
from app.models.inbox import Notification
from app.models.lock import Device
from app.models.penalty import Penalty
from app.models.user import User, UserRole
from app.schemas.penalty import GoalPenaltyIn, PenaltyIn, ShortenIn
from app.services import chores as svc
from app.services import goals, goals_hook, penalties, penalty_earnback
from app.services.goals_out import goal_out

router = APIRouter(prefix="/api/v1", tags=["penalties"], dependencies=[Depends(require_parent)])


def _kid(db: Session, kid_id: int) -> User:
    k = db.get(User, kid_id)
    if k is None or k.role != UserRole.KID or not k.is_active:
        raise HTTPException(404, "That kid doesn't exist. Pick a kid from the list.")
    return k


def _penalty(db: Session, penalty_id: int, *statuses: str) -> Penalty:
    p = db.get(Penalty, penalty_id)
    if p is None:
        raise HTTPException(404, "That penalty doesn't exist.")
    if p.status not in statuses:
        raise HTTPException(409, "That penalty is no longer active.")
    return p


@router.get("/penalties/options")
def options(db: Session = Depends(get_db)):
    fam = get_family(db)
    kids = (
        db.query(User)
        .options(selectinload(User.devices).selectinload(Device.groups))
        .filter(User.role == UserRole.KID, User.is_active.is_(True))
        .order_by(User.full_name, User.id)
        .all()
    )
    recent = penalties.recent_counts(db, datetime.now(UTC))
    rows = []
    for k in kids:
        devs = [d for d in k.devices if not d.exempt]
        groups = {g.id: g.name for d in devs for g in d.groups}
        rows.append(
            {
                "id": k.id,
                "name": k.full_name,
                "recent": recent.get(k.id, 0),
                "devices": [{"id": d.id, "name": d.name} for d in devs],
                "groups": [{"id": i, "name": n} for i, n in groups.items()],
            }
        )
    return {
        "enabled": fam.penalties_enabled,
        "sizes": penalties.sizes(fam),
        "makeup_chores": penalties.makeup_list(fam),
        "kids": rows,
        "goals": _family_goals(db, fam),
    }


def _family_goals(db: Session, fam) -> list[dict]:
    """Live family goals a family penalty can hit; none while Goals is off."""
    if not fam.goals_on:
        return []
    rows = (
        db.query(Goal)
        .filter(Goal.kid_id.is_(None), Goal.status.in_(("active", "full")))
        .order_by(Goal.created_at, Goal.id)
    )
    return [
        {"id": g.id, "name": g.name, "saved": goals.saved(db, g.id), "target": g.target}
        for g in rows
    ]


@router.post("/penalties", status_code=201)
def give(body: PenaltyIn, db: Session = Depends(get_db), parent: User = Depends(require_parent)):
    if not get_family(db).penalties_enabled:
        raise HTTPException(409, "Penalties are turned off. Turn them on in Settings.")
    ids = list(dict.fromkeys(body.kid_ids))
    for i in ids:
        _kid(db, i)
    if body.chore_run_id is not None:
        run = db.get(ChoreRun, body.chore_run_id)
        if run is None:
            raise HTTPException(404, "We couldn't find that chore.")
        if not set(ids) & set(svc.run_kid_ids(run)):
            raise HTTPException(422, "That chore doesn't belong to this kid.")
    if body.notification_id is not None and db.get(Notification, body.notification_id) is None:
        raise HTTPException(404, "We couldn't find that alert.")
    g = penalties.Give(
        kind=body.kind,
        amount=body.amount,
        earn_back=body.earn_back,
        reason=body.reason,
        device_id=body.device_id,
        group_id=body.group_id,
        makeup=body.makeup,
        chore_run_id=body.chore_run_id,
        notification_id=body.notification_id,
    )
    rows = penalties.give(db, ids, g, parent, datetime.now(UTC))
    trigger()
    return penalties.out_many(db, rows)


@router.post("/penalties/goal")
def goal_penalty(
    body: GoalPenaltyIn, db: Session = Depends(get_db), parent: User = Depends(require_parent)
):
    fam = get_family(db)
    if not fam.penalties_enabled:
        raise HTTPException(409, "Penalties are turned off. Turn them on in Settings.")
    if not fam.goals_on:
        raise HTTPException(409, "Goals are turned off.")
    if body.mode == "take":
        g = goals_hook.take(db, body.goal_id, parent, body.amount, body.reason)
    else:
        g = goals_hook.raise_target(db, body.goal_id, parent, body.amount, body.reason)
    return goal_out(db, g, parent, fam)


@router.get("/kids/{kid_id}/penalties")
def kid_penalties(kid_id: int, db: Session = Depends(get_db)):
    _kid(db, kid_id)
    rows = (
        db.query(Penalty)
        .filter(
            Penalty.kid_id == kid_id,
            (Penalty.status == "active")
            | (
                (Penalty.status == "ended")
                & (Penalty.ended_at >= datetime.now(UTC).replace(tzinfo=None) - timedelta(days=7))
            ),
        )
        .order_by(Penalty.created_at.desc(), Penalty.id.desc())
        .all()
    )
    return penalties.out_many(db, rows)


@router.post("/penalties/{penalty_id}/shorten")
def shorten(penalty_id: int, body: ShortenIn, db: Session = Depends(get_db)):
    p = _penalty(db, penalty_id, "active")
    try:
        penalty_earnback.shorten(db, p, body.minutes, datetime.now(UTC))
    except ValueError as e:
        raise HTTPException(409, str(e)) from None
    trigger()
    return penalties.out(db, p)


@router.post("/penalties/{penalty_id}/forgive")
def forgive(penalty_id: int, db: Session = Depends(get_db)):
    p = _penalty(db, penalty_id, "active")
    penalty_earnback.forgive(db, p, datetime.now(UTC))
    trigger()
    return penalties.out(db, p)


@router.post("/penalties/{penalty_id}/cancel")
def cancel(penalty_id: int, db: Session = Depends(get_db)):
    p = _penalty(db, penalty_id, "active", "ended")
    penalty_earnback.cancel(db, p, datetime.now(UTC))
    trigger()
    return penalties.out(db, p)
