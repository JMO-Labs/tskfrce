"""Family-visible progression: leaderboard and sibling profiles (parent or kid token)."""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_current_active_user, get_db
from app.flair.catalog import CATALOG, equipped_many
from app.lock.reset import current_chore_day
from app.models.family import get_family
from app.models.user import User, UserRole
from app.services import badges, progression

router = APIRouter(
    prefix="/api/v1", tags=["community"], dependencies=[Depends(get_current_active_user)]
)


def _profiles(db: Session, kids: list[User]) -> list[dict]:
    fam = get_family(db)
    today = current_chore_day(fam, datetime.now(UTC))
    ids = [k.id for k in kids]
    totals = progression.xp_many(db, ids)
    days = progression.chore_days_many(db, ids, today)
    flair, badge_rows = equipped_many(db, ids), badges.badges_for_many(db, ids)
    out = []
    for kid in kids:
        lv = progression.level_for(totals[kid.id])
        out.append(
            {
                "kid_id": kid.id,
                "name": kid.full_name or kid.username,
                "avatar": kid.avatar,
                "level": lv.level,
                "title": lv.title,
                **progression.streak_fields(
                    progression.streak_for(days[kid.id], today, fam.streak_freeze),
                    fam.streak_freeze,
                ),
                "badges": badge_rows[kid.id],
                "flair": flair[kid.id],
            }
        )
    return out


@router.get("/flair/emblems")
def emblems():
    """Emblem id -> emoji, so every viewer can render a kid's equipped emblem."""
    return {f.id: f.emblem for f in CATALOG if f.emblem}


@router.get("/leaderboard")
def get_leaderboard(db: Session = Depends(get_db)):
    return progression.leaderboard(db, get_family(db), datetime.now(UTC))


@router.get("/profiles")
def list_profiles(db: Session = Depends(get_db)):
    kids = db.query(User).filter(User.role == UserRole.KID, User.is_active).order_by(User.id).all()
    return _profiles(db, kids)


@router.get("/profiles/{kid_id}")
def get_profile(kid_id: int, db: Session = Depends(get_db)):
    kid = db.get(User, kid_id)
    if kid is None or kid.role != UserRole.KID:
        raise HTTPException(404, "We couldn't find that kid.")
    return _profiles(db, [kid])[0]
