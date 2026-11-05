"""Parent API: one-time QR to sign a kid's phone in; list and remove the kid's phones."""

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_parent
from app.api.kids import _kid
from app.core.config import settings
from app.models.kid_device import KidDevice
from app.models.user import User
from app.schemas.lock import utc_z
from app.services import kid_enroll
from app.services.qr import qr_svg

parent_router = APIRouter(
    prefix="/api/v1/kids", tags=["kids"], dependencies=[Depends(require_parent)]
)


@parent_router.post("/{kid_id}/enroll", status_code=201)
def issue_enroll(kid_id: int, db: Session = Depends(get_db), me: User = Depends(require_parent)):
    kid = _kid(db, kid_id)
    if not settings.BOX_URL:
        raise HTTPException(409, "Set BOX_URL on the box first.")
    raw, expires = kid_enroll.issue(db, kid, me)
    url = kid_enroll.enroll_url(raw)
    return {"url": url, "qr_svg": qr_svg(url), "expires_at": utc_z(expires)}


@parent_router.get("/{kid_id}/phones")
def list_phones(kid_id: int, db: Session = Depends(get_db)):
    kid = _kid(db, kid_id)
    rows = (
        db.query(KidDevice)
        .filter(KidDevice.kid_id == kid.id)
        .order_by(KidDevice.created_at.desc(), KidDevice.id.desc())
        .all()
    )
    return [
        {
            "id": d.id,
            "label": d.label,
            "created_at": utc_z(d.created_at),
            "last_seen_at": utc_z(d.last_seen_at),
        }
        for d in rows
    ]


@parent_router.delete("/{kid_id}/phones/{phone_id}", status_code=204)
def remove_phone(kid_id: int, phone_id: int, db: Session = Depends(get_db)):
    kid = _kid(db, kid_id)
    d = db.get(KidDevice, phone_id)
    if d is None or d.kid_id != kid.id:
        raise HTTPException(404, "We couldn't find that phone.")
    db.delete(d)
    db.commit()
    return Response(status_code=204)
