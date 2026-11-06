"""Integration widgets for parent screens, always framed with the integration's name and icon."""

import json
import re
import time
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_current_active_user, get_db, require_parent
from app.api.kid import require_kid
from app.integrations import audit, health, widget_service
from app.integrations.apply import apply_actions
from app.integrations.net import BlockedError, FetchError
from app.integrations.protocol import KEY_PATTERN
from app.models.integration import IntegrationInstall, IntegrationKid
from app.models.user import User, UserRole

router = APIRouter(prefix="/api/v1/integration-widgets", tags=["integrations"])
IMAGE_HEADERS = {
    "Cache-Control": "private, max-age=300",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'",
}


@router.get("", dependencies=[Depends(require_parent)])
def parent_widgets(surface: Literal["parent"] = "parent", db: Session = Depends(get_db)):
    rows = db.query(IntegrationInstall).filter_by(status="active").order_by(IntegrationInstall.id)
    now, out = time.time(), []
    for i in rows.all():
        if "widgets.parent" not in json.loads(i.permissions):
            continue
        widgets = widget_service.get(db, i, surface, None, now)
        if widgets:
            out.append({"install_id": i.id, "name": i.name, "icon": i.icon, "widgets": widgets})
    db.commit()  # health counters
    return out


@router.get("/kid")
def kid_widgets(user: User = Depends(require_kid), db: Session = Depends(get_db)):
    """Cards for the calling kid: only active installs that granted widgets.kid and that the
    parent turned on for this kid. Each service sees only this kid."""
    ids = [
        r.install_id for r in db.query(IntegrationKid).filter_by(kid_id=user.id, kid_widgets=True)
    ]
    rows = db.query(IntegrationInstall).filter(
        IntegrationInstall.id.in_(ids), IntegrationInstall.status == "active"
    )
    now, out = time.time(), []
    for i in rows.order_by(IntegrationInstall.id).all():
        if "widgets.kid" not in json.loads(i.permissions):
            continue
        widgets = widget_service.get(db, i, "kid", user.id, now)
        if widgets:
            out.append({"install_id": i.id, "name": i.name, "icon": i.icon, "widgets": widgets})
    db.commit()  # health counters
    return out


@router.get("/{install_id}/image")
def widget_image(
    install_id: int,
    u: str,
    user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Proxy an image a live widget of this install shows, so the integration never sees who
    views it. Only upstream bytes are passed on: no upstream headers or cookies."""
    install = db.get(IntegrationInstall, install_id)
    if install is None or install.status != "active":
        raise HTTPException(404)
    if user.role == UserRole.PARENT:
        allowed = widget_service.image_allowed(install_id, u)
    else:
        link = (
            db.query(IntegrationKid)
            .filter_by(install_id=install_id, kid_id=user.id, kid_widgets=True)
            .first()
        )
        allowed = link is not None and widget_service.image_allowed(install_id, u, user.id)
    if not allowed:
        raise HTTPException(404)
    try:
        ctype, body = widget_service.image(u)
    except (BlockedError, FetchError) as e:
        raise HTTPException(502, "image unavailable") from e
    return Response(body, media_type=ctype, headers=IMAGE_HEADERS)


class PressIn(BaseModel):
    widget_id: str
    button_id: str
    kid_id: int | None = None


def _not_this_button(db: Session, install: IntegrationInstall, raw: dict) -> audit.ActionResult:
    """Audit a reply action that is not the pressed button's action as rejected. A key seen
    before keeps its earlier result."""
    key = raw.get("idempotency_key")
    if not (isinstance(key, str) and re.fullmatch(KEY_PATTERN, key)):
        key = f"invalid:{uuid4().hex}"
    if row := audit.prior(db, install.id, key):
        return audit.as_result(row)
    row = audit.record(
        db, install, str(raw.get("type")), key, "rejected", "not this button's action"
    )
    try:
        db.commit()
    except IntegrityError:  # a concurrent duplicate won the key; its result stands
        db.rollback()
        row = audit.prior(db, install.id, key)
    return audit.as_result(row)


@router.post("/{install_id}/press")
def press(
    install_id: int,
    body: PressIn,
    user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Tell the integration a button it showed on this surface was pressed, then apply the
    reply actions that match the button's action, as that button's origin."""
    gone = HTTPException(404, "That button is gone.")
    install = db.get(IntegrationInstall, install_id)
    if install is None or install.status != "active":
        raise gone
    is_kid = user.role != UserRole.PARENT
    if is_kid:
        link = (
            db.query(IntegrationKid)
            .filter_by(install_id=install_id, kid_id=user.id, kid_widgets=True)
            .first()
        )
        if link is None:
            raise gone
        kid_id = user.id
    else:  # parent widgets are cached without a kid; the body kid only goes in the event
        kid_id = body.kid_id
        linked = db.query(IntegrationKid).filter_by(install_id=install_id, kid_id=kid_id)
        if kid_id is not None and linked.first() is None:
            raise HTTPException(422, "That kid isn't linked to this integration.")
    surface = "kid" if is_kid else "parent"
    b = widget_service.button(
        install_id, surface, kid_id if is_kid else None, body.widget_id, body.button_id
    )
    if b is None:
        raise gone
    event = {
        "kind": "widget.pressed",
        "widget_id": body.widget_id,
        "button_id": body.button_id,
        "by": surface,
        "kid_id": kid_id,
    }
    reply = health.guarded_call(db, install, lambda c: c.events([event]))
    widget_service.forget(install_id)
    if reply is None:
        db.commit()  # health counters
        raise HTTPException(502, f"{install.name} didn't answer.")
    db.commit()
    origin = "kid_button" if is_kid else "parent_button"
    out = []
    for raw in reply.actions:
        if isinstance(raw, dict) and raw.get("type") == b["action"]:
            out += apply_actions(
                db, install, [raw], origin=origin, actor_kid_id=user.id if is_kid else None
            )
        else:
            out.append(_not_this_button(db, install, raw if isinstance(raw, dict) else {}))
    return [{"result": r.result, "reason": r.reason} for r in out]
