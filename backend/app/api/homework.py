"""Parent API: homework site lists, activity and kid requests."""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_parent
from app.lock.loop import trigger
from app.models.homework import HomeworkActivity, HomeworkSite
from app.models.lock import Device, Override
from app.models.user import User, UserRole
from app.schemas.homework import SiteIn
from app.schemas.lock import utc_z
from app.services.homework_domains import STARTER, normalize_domain

router = APIRouter(
    prefix="/api/v1/homework", tags=["homework"], dependencies=[Depends(require_parent)]
)


def _kid(db: Session, kid_id: int) -> User:
    kid = db.get(User, kid_id)
    if kid is None or kid.role != UserRole.KID:
        raise HTTPException(404, "We couldn't find that kid.")
    return kid


def _site(db: Session, body: SiteIn) -> str:
    """Validated, normalised domain for `body`."""
    domain = normalize_domain(body.domain)
    if domain is None:
        raise HTTPException(400, "That doesn't look like a website address.")
    if body.kind == "block" and body.kid_id is not None:
        raise HTTPException(400, "Blocks apply to the whole family.")
    if body.kid_id is not None:
        _kid(db, body.kid_id)
    return domain


def _rows(db: Session, domain: str, kind: str, kid_id: int | None):
    q = db.query(HomeworkSite).filter_by(domain=domain, kind=kind)
    return q.filter(
        HomeworkSite.kid_id.is_(None) if kid_id is None else HomeworkSite.kid_id == kid_id
    )


@router.get("/sites")
def sites(db: Session = Depends(get_db)) -> dict:
    out: dict = {"starter": list(STARTER), "allow": [], "block": [], "kids": {}}
    for s in db.query(HomeworkSite).order_by(HomeworkSite.domain):
        if s.kid_id is None:
            out[s.kind].append(s.domain)
        else:
            out["kids"].setdefault(s.kid_id, []).append(s.domain)
    return out


@router.post("/sites")
def add_site(body: SiteIn, db: Session = Depends(get_db)) -> dict:
    domain = _site(db, body)
    if body.kind == "block":
        _rows(db, domain, "allow", None).delete(synchronize_session=False)
    if _rows(db, domain, body.kind, body.kid_id).first() is None:
        db.add(HomeworkSite(domain=domain, kind=body.kind, kid_id=body.kid_id))
    db.commit()
    trigger()
    return {"domain": domain, "kind": body.kind, "kid_id": body.kid_id}


@router.delete("/sites", status_code=204)
def remove_site(body: SiteIn, db: Session = Depends(get_db)) -> Response:
    domain = _site(db, body)
    if not _rows(db, domain, body.kind, body.kid_id).delete(synchronize_session=False):
        if body.kind == "allow" and body.kid_id is None and domain in STARTER:
            raise HTTPException(404, "That site is on the built-in list.")
    db.commit()
    trigger()
    return Response(status_code=204)


def _session(db: Session, d: Device, now: datetime) -> dict | None:
    """The device's current or most recent homework session, busiest names first."""
    start = db.query(func.max(HomeworkActivity.session_start)).filter_by(device_id=d.id).scalar()
    if start is None:
        return None
    rows = (
        db.query(HomeworkActivity)
        .filter_by(device_id=d.id, session_start=start)
        .order_by(HomeworkActivity.active_minutes.desc(), HomeworkActivity.domain)
    )
    live = (
        db.query(Override)
        .filter_by(device_id=d.id, source="manual", action="homework")
        .filter(Override.expires_at > now)
        .first()
    )
    kid = next((o for o in d.owners if o.role == UserRole.KID), None)
    return {
        "device_id": d.id,
        "device_name": d.name,
        "kid_id": kid.id if kid else None,
        "kid_name": (kid.full_name or kid.username) if kid else None,
        "session_start": utc_z(start),
        "active": live is not None,
        "until": utc_z(live.expires_at) if live else None,
        "items": [
            {
                "domain": r.domain,
                "via": r.via,
                "pulled_by": r.pulled_by,
                "active_minutes": r.active_minutes,
                "last_seen": utc_z(r.last_seen),
            }
            for r in rows
        ],
    }


@router.get("/activity")
def activity(
    device_id: int | None = None, kid_id: int | None = None, db: Session = Depends(get_db)
) -> list[dict]:
    if device_id is not None:
        d = db.get(Device, device_id)
        if d is None:
            raise HTTPException(404, "That device doesn't exist. Refresh the list and try again.")
        devices = [d]
    elif kid_id is not None:
        devices = list(_kid(db, kid_id).devices)
    else:
        ids = db.query(HomeworkActivity.device_id).distinct()
        devices = db.query(Device).filter(Device.id.in_(ids)).all()
    now = datetime.now(UTC).replace(tzinfo=None)
    out = [s for d in sorted(devices, key=lambda d: d.id) if (s := _session(db, d, now))]
    return sorted(out, key=lambda s: s["session_start"], reverse=True)
