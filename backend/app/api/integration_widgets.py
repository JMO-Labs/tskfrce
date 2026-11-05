"""Integration widgets for parent screens, always framed with the integration's name and icon."""

import json
import time
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from app.api.deps import get_current_active_user, get_db, require_parent
from app.integrations import widget_service
from app.integrations.net import BlockedError, FetchError
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
