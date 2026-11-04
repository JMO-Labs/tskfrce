"""Parent API: homework site lists, activity and kid requests."""

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_parent
from app.lock.loop import trigger
from app.models.homework import HomeworkSite
from app.models.user import User, UserRole
from app.schemas.homework import SiteIn
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
