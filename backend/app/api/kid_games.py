"""Kid minigames: the shelf, starting and finishing rounds."""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.api.kid import require_kid, view_kid
from app.models.family import get_family
from app.models.game import GamePlay
from app.models.user import User
from app.services import economy
from app.services import minigames_play as play

router = APIRouter(prefix="/api/v1/kid/games", tags=["kid-games"])


class Part(BaseModel):
    game: str = Field(max_length=24)
    ok: bool
    ms: int


class FinishIn(BaseModel):
    token: str = Field(max_length=64)
    score: int = 0
    parts: list[Part] | None = Field(default=None, max_length=60)


@router.get("")
def shelf(db: Session = Depends(get_db), kid: User = Depends(view_kid)):
    return play.shelf(db, get_family(db), kid, datetime.now(UTC))


@router.post("/start")
def start(db: Session = Depends(get_db), kid: User = Depends(require_kid)):
    return play.start(db, get_family(db), kid, datetime.now(UTC))


@router.post("/finish")
def finish(body: FinishIn, db: Session = Depends(get_db), kid: User = Depends(require_kid)):
    parts = [p.model_dump() for p in body.parts] if body.parts is not None else None
    with economy.SPEND_LOCK:  # cap read + payout must not interleave with another finish
        db.commit()  # fresh snapshot: see a racing finish's payout
        return play.finish(
            db, get_family(db), kid, body.token, body.score, parts, datetime.now(UTC)
        )


@router.post("/seen", status_code=204)
def seen(db: Session = Depends(get_db), kid: User = Depends(require_kid)):
    db.query(GamePlay).filter_by(kid_id=kid.id, status="saved").update({"seen": True})
    db.commit()
    return Response(status_code=204)
