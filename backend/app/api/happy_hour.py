"""Parent API: start, stop and list Happy Hours."""

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_parent
from app.models.family import get_family
from app.models.happy_hour import HappyHour
from app.models.user import User, UserRole
from app.services import happy_hour

router = APIRouter(
    prefix="/api/v1/happy-hour", tags=["happy-hour"], dependencies=[Depends(require_parent)]
)


class StartIn(BaseModel):
    kid_ids: list[int] | None = None  # None or empty = all kids
    minutes: Literal[30, 60, 90] | None = None
    mult_x10: Literal[15, 20, 30] | None = None


@router.post("")
def start(body: StartIn, db: Session = Depends(get_db), parent: User = Depends(require_parent)):
    ids = sorted(set(body.kid_ids or []))
    if ids:
        q = db.query(User.id).filter(User.id.in_(ids), User.role == UserRole.KID, User.is_active)
        if q.count() != len(ids):
            raise HTTPException(422, "Pick kids from this family.")
    fam = get_family(db)
    hh = happy_hour.start(
        db,
        kid_ids=ids or None,
        minutes=body.minutes or fam.hh_default_minutes,
        mult_x10=body.mult_x10 or fam.hh_default_mult_x10,
        source="parent",
        by=parent.id,
    )
    db.commit()
    return happy_hour.out(hh)


@router.post("/{hh_id}/stop")
def stop(hh_id: int, db: Session = Depends(get_db)):
    hh = db.get(HappyHour, hh_id)
    if hh is None:
        raise HTTPException(404, "That Happy Hour doesn't exist.")
    happy_hour.stop(hh)
    db.commit()
    return happy_hour.out(hh)


@router.get("")
def overview(db: Session = Depends(get_db)):
    """Running now, plus the last 10 (newest first)."""
    now = datetime.utcnow()
    recent = db.query(HappyHour).order_by(HappyHour.id.desc()).limit(10).all()
    return {
        "active": [happy_hour.out(h) for h in happy_hour.running(db, now)],
        "recent": [happy_hour.out(h) for h in recent],
    }
