"""Parent API: serious system warnings for Today (never hideable)."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_parent
from app.services import system_warnings as svc

router = APIRouter(prefix="/api/v1/system", tags=["system"], dependencies=[Depends(require_parent)])


@router.get("/warnings")
def system_warnings(db: Session = Depends(get_db)) -> dict:
    return svc.warnings(db)
