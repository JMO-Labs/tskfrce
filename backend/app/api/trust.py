"""Parent API: Wasn't done (take back a self-approved chore) and the self-approved list."""

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_parent
from app.models.chore_extra import ChorePhoto
from app.models.chores import ChoreRun
from app.models.family import get_family
from app.models.points import Points
from app.models.user import User, UserRole
from app.schemas.lock import utc_z
from app.services import chat, economy, inbox, minigames, penalty_earnback, trust
from app.services import chores as svc

router = APIRouter(prefix="/api/v1", tags=["trust"], dependencies=[Depends(require_parent)])

SELF = trust.SELF_APPROVED
WINDOW = timedelta(days=7)


class TakeBack(BaseModel):
    lower_trust: bool = True


@router.post("/chores/{run_id}/take-back")
def take_back(
    run_id: int,
    body: TakeBack | None = None,
    db: Session = Depends(get_db),
    parent: User = Depends(require_parent),
):
    """Wasn't done: remove the points a self-approved chore earned (never below zero)."""
    r = db.get(ChoreRun, run_id)
    if r is None:
        raise HTTPException(404, "That chore doesn't exist.")
    if r.status != "done" or r.approved_via not in SELF:
        raise HTTPException(409, "Only a chore that approved itself can be taken back.")
    lower = body.lower_trust if body else True
    today = r.day == svc.today(db)
    title = svc.chore_of(r).title
    msg = (
        f"A parent checked {title} and it needs another go."
        if today
        else f"A parent checked {title} and took its points back."
    )
    with economy.SPEND_LOCK:
        db.commit()  # fresh snapshot, so a second tap sees the first
        try:
            won = (  # compare-and-set: only one caller moves it out of done
                db.query(ChoreRun)
                .filter(
                    ChoreRun.id == r.id, ChoreRun.status == "done", ChoreRun.approved_via.in_(SELF)
                )
                .update({"status": "todo" if today else "cancelled"}, synchronize_session=False)
            )
            if won != 1:
                raise HTTPException(409, "This chore was already taken back.")
            db.refresh(r)
            economy.take_back(db, r)
            minigames.revoke(db, r)
            if r.penalty_id:
                penalty_earnback.on_reverted(db, r, datetime.now(UTC))
            kids = trust.payees(r)
            trust.catch_run(db, r, parent.id, lower)
            inbox.notify(db, kids, "chore_sent_back", msg, run_id=r.id)
            r.ticks.clear()
            r.attempt = (r.attempt or 1) + 1  # old photos no longer count
            r.last_note = "A parent checked this one. Give it another go, then mark it done!"
            r.approved_at = r.completed_at = r.approved_by_id = r.approved_via = None
            r.spot_check = False
            r.submitted_at = r.submitted_by_id = r.hh_mult_x10 = None
            chat.system(db, r, "A parent checked this one · points taken back")
            db.commit()  # one commit: ledger, run and trust change together
        except BaseException:
            db.rollback()
            raise
    return svc.chore_out(r, get_family(db))


@router.get("/kids/{kid_id}/self-approved")
def self_approved(kid_id: int, db: Session = Depends(get_db)):
    """Chores that approved themselves in the last 7 days, newest first."""
    kid = db.get(User, kid_id)
    if kid is None or kid.role != UserRole.KID:
        raise HTTPException(404, "That kid doesn't exist. Pick a kid from the list.")
    runs = (
        svc.with_detail(db.query(ChoreRun), kids=False)
        .filter(
            svc.kid_runs_filter(kid.id),
            ChoreRun.status == "done",
            ChoreRun.approved_via.in_(SELF),
            ChoreRun.approved_at >= datetime.utcnow() - WINDOW,
        )
        .order_by(ChoreRun.approved_at.desc(), ChoreRun.id.desc())
        .all()
    )
    ids = [r.id for r in runs]
    pts = dict(
        db.query(Points.run_id, func.sum(Points.amount))
        .filter(Points.run_id.in_(ids), Points.user_id == kid.id, Points.amount > 0)
        .group_by(Points.run_id)
    )
    photos = dict(
        db.query(ChorePhoto.run_id, func.count())
        .filter(ChorePhoto.run_id.in_(ids))
        .group_by(ChorePhoto.run_id)
    )
    return [
        {
            "id": r.id,
            "title": svc.chore_of(r).title,
            "day": r.day.isoformat(),
            "approved_at": utc_z(r.approved_at),
            "approved_via": r.approved_via,
            "points": int(pts.get(r.id, 0)),
            "photos": photos.get(r.id, 0),
        }
        for r in runs
    ]
