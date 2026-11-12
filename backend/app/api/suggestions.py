"""Parent API: Today suggestions (list, dismiss, mute, hide)."""

import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_parent
from app.services import suggestions as svc

router = APIRouter(
    prefix="/api/v1/suggestions", tags=["suggestions"], dependencies=[Depends(require_parent)]
)

KEY = re.compile(r"^[a-z0-9._:-]{1,80}$")


class DismissIn(BaseModel):
    key: str = Field(max_length=80)
    fingerprint: str = Field(min_length=1, max_length=80)


class MuteIn(BaseModel):
    rule: str = Field(max_length=80)


@router.get("")
def list_suggestions(db: Session = Depends(get_db)) -> dict:
    return svc.suggestions(db)


@router.post("/dismiss")
def dismiss(body: DismissIn, db: Session = Depends(get_db)) -> dict:
    if not KEY.match(body.key) or body.key.startswith("_"):
        raise HTTPException(400, "Invalid suggestion key.")
    svc.dismiss(db, body.key, body.fingerprint)
    return {"ok": True}


@router.post("/mute")
def mute(body: MuteIn, db: Session = Depends(get_db)) -> dict:
    if body.rule not in svc.MUTABLE_RULES:
        raise HTTPException(400, "That suggestion can't be muted.")
    svc.mute(db, body.rule)
    return {"ok": True}


@router.delete("/muted")
def reset_muted(db: Session = Depends(get_db)) -> dict:
    svc.reset_muted(db)
    return {"ok": True}


@router.post("/hide")
def hide(db: Session = Depends(get_db)) -> dict:
    svc.hide(db)
    return {"ok": True}


@router.delete("/hide")
def show(db: Session = Depends(get_db)) -> dict:
    svc.show(db)
    return {"ok": True}
