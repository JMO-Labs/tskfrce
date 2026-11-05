"""Integration widgets for parent screens, always framed with the integration's name and icon."""

import json
import time
from typing import Literal

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_parent
from app.integrations import widget_service
from app.models.integration import IntegrationInstall

router = APIRouter(prefix="/api/v1/integration-widgets", tags=["integrations"])


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
