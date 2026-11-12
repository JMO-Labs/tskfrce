"""Browser intake: events, kid age group and parent feedback."""

import time
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.api.deps import get_current_active_user, get_db, require_parent
from app.api.internal import require_token
from app.core.client_ip import client_ip
from app.core.config import settings
from app.core.logging import get_logger
from app.core.ratelimit import limit
from app.eval import store
from app.eval.config import APP_VERSION, any_on, feedback_on, stats_on
from app.eval.events import _ERR, FAULT_COMPONENTS, FAULT_KINDS, ROUTES, box_fault, clean, emit
from app.eval.sender import SHOTS_DIR
from app.models.user import User, UserRole

logger = get_logger(__name__)
router = APIRouter(prefix="/api/v1/eval", tags=["eval"])

MAX_SHOT = 3 * 1024 * 1024
EXT = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}


class EventIn(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    props: dict[str, str | int] = {}


class FaultIn(BaseModel):
    component: str
    kind: str

    @field_validator("component")
    @classmethod
    def _component(cls, v: str) -> str:
        if v not in FAULT_COMPONENTS:
            raise ValueError("unknown component")
        return v

    @field_validator("kind")
    @classmethod
    def _kind(cls, v: str) -> str:
        if v not in FAULT_KINDS:
            raise ValueError("unknown kind")
        return v


class AgeIn(BaseModel):
    age_group: Literal["≤7", "8–10", "11–13", "14+"]


internal_router = APIRouter(
    prefix="/internal/eval", tags=["eval-internal"], dependencies=[Depends(require_token)]
)


@internal_router.post("/fault", status_code=204)
def fault(body: FaultIn):
    """Blocker/edge report a box-side failure. Best-effort; no-op when stats are off."""
    box_fault(body.component, body.kind)
    return Response(status_code=204)


def _bad(msg: str) -> HTTPException:
    return HTTPException(status_code=422, detail=msg)


@router.get("/status")
def status(user: User = Depends(get_current_active_user)):
    return {
        "stats": stats_on(),
        "feedback": feedback_on(),
        "household": store.household() if any_on() else None,
    }


@router.post("/event", status_code=204)
def event(body: EventIn, user: User = Depends(get_current_active_user)):
    if stats_on():
        cleaned = clean(body.name, body.props)
        if cleaned is not None:
            is_kid = user.role != UserRole.PARENT
            try:
                if body.name == "feature":
                    store.bump(f"feat:{cleaned['area']}")
                emit(
                    body.name,
                    cleaned,
                    source="kid" if is_kid else "parent",
                    age_group=store.kid_age(user.id) if is_kid else None,
                    url=cleaned.get("route", "/app"),
                )
                if body.name == "wizard_done" and store.kv_get("wizard_done_at") is None:
                    store.kv_set("wizard_done_at", str(time.time()))
            except Exception as e:
                logger.warning("Eval event failed", error=type(e).__name__)
    return Response(status_code=204)


ANON_EVENTS = ("auth", "screen_view", "feature")
ANON_PER_MIN = 30


@router.post("/anon-event", status_code=204)
def anon_event(body: EventIn, request: Request):
    """Pre-login intake: auth results, screen views and the wifi-setup feature event."""
    limit(f"eval-anon:{client_ip(request)}", ANON_PER_MIN, 60)
    if stats_on() and body.name in ANON_EVENTS:
        cleaned = clean(body.name, body.props)
        if body.name == "feature" and cleaned and cleaned["area"] != "wifi":
            cleaned = None
        if cleaned is not None:
            emit(body.name, cleaned, source="anon", url=cleaned.get("route", "/app"))
    return Response(status_code=204)


@router.put("/kids/{kid_id}/age", status_code=204)
def set_age(
    kid_id: int,
    body: AgeIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_parent),
):
    kid = db.get(User, kid_id)
    if kid is None or kid.role != UserRole.KID:
        raise HTTPException(status_code=404, detail="That kid doesn't exist.")
    if stats_on():
        try:
            store.set_kid_age(kid_id, body.age_group)
        except Exception as e:
            logger.warning("Eval kid age failed", error=type(e).__name__)
    return Response(status_code=204)


@router.post("/feedback")
async def feedback(
    type: str = Form(""),
    stars: str | None = Form(None),
    text: str = Form(""),
    route: str = Form("other"),
    errors: str = Form(""),
    shots: list[UploadFile] = File(default=[]),
    user: User = Depends(require_parent),
):
    if type not in ("feature", "bug", "other"):
        raise _bad("Pick Feature idea, Bug or Other.")
    n_stars = None
    if stars not in (None, ""):
        if not (stars.isascii() and stars.isdigit()) or not 1 <= int(stars) <= 5:
            raise _bad("Stars go from 1 to 5.")
        n_stars = int(stars)
    text = text.replace("\x00", "").strip()
    if not text:
        raise _bad("Write a short note first.")
    if len(text) > 2000:
        raise _bad("Keep the note under 2,000 characters.")
    if len(shots) > 3:
        raise _bad("Send up to 3 screenshots.")
    blobs = []
    for s in shots:
        if s.content_type not in EXT:
            raise _bad("Screenshots must be PNG, JPEG or WebP images.")
        data = await s.read(MAX_SHOT + 1)
        if len(data) > MAX_SHOT:
            raise _bad("Each screenshot must be under 3 MB.")
        blobs.append((EXT[s.content_type], data))
    if feedback_on():
        route = route if route in ROUTES else "other"
        errs = [e for e in (x.strip() for x in errors.split(",")) if _ERR.fullmatch(e)][:5]
        fid = str(uuid.uuid4())
        try:
            names = _save_shots(fid, blobs)
            store.enqueue(
                "feedback",
                {
                    "id": fid,
                    "household": store.household(),
                    "type": type,
                    "stars": n_stars,
                    "text": text,
                    "route": route,
                    "app_version": APP_VERSION,
                    "errors": errs if type == "bug" else [],
                    "created_at": datetime.now(UTC).isoformat(),
                    "shots": names,
                },
            )
        except Exception as e:
            logger.warning("Eval feedback save failed", error=type(e).__name__)
            raise HTTPException(503, "Couldn't save your feedback. Try again.") from e
        emit("feedback_sent", {"type": type, "stars": n_stars or 0}, source="parent", url=route)
    return {"ok": True}


def _save_shots(fid: str, blobs: list[tuple[str, bytes]]) -> list[str]:
    if not blobs:
        return []
    d = Path(settings.DATA_DIR) / SHOTS_DIR
    d.mkdir(parents=True, exist_ok=True)
    names = []
    for i, (ext, data) in enumerate(blobs):
        (d / f"{fid}-{i}.{ext}").write_bytes(data)
        names.append(f"{fid}-{i}.{ext}")
    return names
