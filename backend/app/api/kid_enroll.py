"""Kid phone enrollment. Parent: issue a one-time QR, list and remove phones.
Kid: redeem the code for a device session, refresh it. Secrets travel in POST bodies only."""

import secrets

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_parent
from app.api.kids import _kid
from app.core.auth import AuthService
from app.core.client_ip import client_ip
from app.core.config import settings
from app.core.ratelimit import check, hit
from app.models.kid_device import KidDevice
from app.models.user import User
from app.schemas.lock import utc_z
from app.services import kid_enroll
from app.services.qr import qr_svg

ENROLL_GONE = "This code has expired or was already used. Ask a parent for a new one."
PHONE_REMOVED = "This phone was removed. Ask a parent for a new code."

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
    kid.alert_topic = secrets.token_urlsafe(24)  # removed phone stops getting alerts
    db.commit()
    return Response(status_code=204)


kid_router = APIRouter(prefix="/api/v1/kid", tags=["kid"])


class EnrollIn(BaseModel):
    token: str = Field(max_length=64)


class SessionIn(BaseModel):
    device_token: str = Field(max_length=64)


def alert_for(kid: User) -> dict | None:
    """Upstream ntfy server and topic for this kid's phone; kid-facing replies only."""
    if not settings.NTFY_UPSTREAM_URL:
        return None
    return {"server": settings.NTFY_UPSTREAM_URL.rstrip("/"), "topic": kid.alert_topic}


def _kid_out(kid: User) -> dict:
    return {"id": kid.id, "full_name": kid.full_name, "avatar": kid.avatar}


@kid_router.post("/enroll")
def redeem_enroll(body: EnrollIn, request: Request, db: Session = Depends(get_db)):
    key = f"enroll:{client_ip(request)}"
    check(key, 10, 60)  # only failed tries count
    got = kid_enroll.redeem(db, body.token, request.headers.get("user-agent", ""))
    if got is None:
        hit(key, 60)
        raise HTTPException(410, ENROLL_GONE)
    kid, dev, secret = got
    return {
        "access_token": kid_enroll.access_for(AuthService(db), kid, dev),
        "device_token": secret,
        "kid": _kid_out(kid),
        "alert": alert_for(kid),
    }


@kid_router.post("/session")
def refresh_session(body: SessionIn, request: Request, db: Session = Depends(get_db)):
    key = f"kidsess:{client_ip(request)}"
    check(key, 10, 60)
    got = kid_enroll.refresh(db, body.device_token)
    if got is None:
        hit(key, 60)
        raise HTTPException(401, PHONE_REMOVED)
    kid, dev = got
    return {
        "access_token": kid_enroll.access_for(AuthService(db), kid, dev),
        "kid": _kid_out(kid),
        "alert": alert_for(kid),
    }
