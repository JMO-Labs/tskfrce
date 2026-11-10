"""Parent API: set up a kid's phone for ntfy alerts (QR + link)."""

import secrets
from urllib.parse import quote_plus, urlparse

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_parent
from app.api.kids import _kid
from app.core.config import settings
from app.services import push
from app.services.qr import qr_svg

router = APIRouter(prefix="/api/v1/kids", tags=["kids"], dependencies=[Depends(require_parent)])


def _out(db: Session, kid, reset: bool = False) -> dict:
    up = {"upstream": bool(settings.NTFY_UPSTREAM_URL)}  # generic kid alerts via a public relay
    if not push.enabled():
        return dict.fromkeys(("server", "topic", "link", "qr_svg")) | {"enabled": False} | up
    if reset or not kid.push_topic:
        kid.push_topic = secrets.token_urlsafe(18)
        db.commit()
    server = push.public_url()
    u = urlparse(server)
    link = f"ntfy://{u.netloc}/{kid.push_topic}?display={quote_plus(kid.full_name + ' chores')}"
    if u.scheme == "http":
        link += "&secure=false"
    return {
        "enabled": True,
        "server": server,
        "topic": kid.push_topic,
        "link": link,
        "qr_svg": qr_svg(link),
    } | up


@router.get("/{kid_id}/push")
def get_push(kid_id: int, db: Session = Depends(get_db)):
    return _out(db, _kid(db, kid_id))


@router.post("/{kid_id}/push/reset")
def reset_push(kid_id: int, db: Session = Depends(get_db)):
    return _out(db, _kid(db, kid_id), reset=True)
