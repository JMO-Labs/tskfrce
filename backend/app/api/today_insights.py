"""Today dashboard: Goals card + This week card data."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_parent
from app.services import today_insights as svc

router = APIRouter(prefix="/api/v1", tags=["today"], dependencies=[Depends(require_parent)])


@router.get("/today/insights")
def insights(db: Session = Depends(get_db)):
    return svc.insights(db)
