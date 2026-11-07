"""Parent API: the weekly recap."""

from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_parent
from app.services import recap

router = APIRouter(prefix="/api/v1/recap", tags=["recap"], dependencies=[Depends(require_parent)])


@router.get("")
def get_recap(week: date | None = None, db: Session = Depends(get_db)):
    return recap.week_of(db, week)
