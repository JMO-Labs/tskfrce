"""Get out of jail free: a fulfilled jail goal is one card; playing it cancels a penalty."""

from datetime import UTC, datetime, timedelta

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.family import get_family
from app.models.goal import Goal
from app.models.penalty import Penalty
from app.models.user import User
from app.services import economy, inbox, penalty_earnback


def _unplayed(db: Session, kid_id: int):
    return db.query(Goal).filter(
        Goal.kind == "jail",
        Goal.kid_id == kid_id,
        Goal.status == "fulfilled",
        Goal.played_at.is_(None),
    )


def cards(db: Session, kid_id: int) -> int:
    """Unplayed cards; none show while Penalties is off."""
    if not get_family(db).penalties_enabled:
        return 0
    return _unplayed(db, kid_id).count()


def play(db: Session, kid: User, penalty_id: int) -> None:
    """Spend one card on the kid's own active (or just-ended) penalty. Instant. Commits."""
    if not get_family(db).penalties_enabled:
        raise HTTPException(400, "Penalties are turned off.")
    with economy.SPEND_LOCK:
        db.commit()  # fresh snapshot: a parallel play may have used the card
        p = db.get(Penalty, penalty_id)
        if p is None or p.kid_id != kid.id:
            raise HTTPException(404, "We couldn't find that penalty.")
        now = datetime.now(UTC)
        recent = p.ended_at and p.ended_at >= now.replace(tzinfo=None) - timedelta(days=7)
        if not (p.status == "active" or (p.status == "ended" and recent)):
            raise HTTPException(409, "That penalty is already over.")
        card = _unplayed(db, kid.id).order_by(Goal.fulfilled_at, Goal.id).first()
        if card is None:
            raise HTTPException(409, "You don't have a Get out of jail free card.")
        card.played_at, card.penalty_id = now.replace(tzinfo=None), p.id
        inbox.notify_parents(
            db, "jail_card", f"{kid.full_name or kid.username} played Get out of jail free"
        )
        db.flush()
        try:
            penalty_earnback.cancel(db, p, now)  # commits card, note and cancel together
        except BaseException:
            db.rollback()
            raise
