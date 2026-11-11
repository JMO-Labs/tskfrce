"""Box updates: version, channel, and upgrade management."""

import os

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import __version__
from app.api.deps import get_db, require_parent
from app.api.internal import require_token
from app.lock.loop import trigger
from app.models.family import get_family
from app.services import inbox

router = APIRouter(prefix="/api/v1", tags=["updates"], dependencies=[Depends(require_parent)])
internal_router = APIRouter(prefix="/internal", tags=["updates-internal"])


class UpdatesOut(BaseModel):
    """Current update status and settings."""

    version: str
    channel: str  # "stable", "eval", or "off"
    last_result: str | None  # "success", "failed", or None
    major_available: str | None  # e.g. "3" if 4 is available


class UpdatesPatch(BaseModel):
    """Update settings changes."""

    channel: str | None = None
    pull_major: str | None = None


def _env_value(key: str) -> str:
    """Read from .env file."""
    env_file = os.path.expanduser("~/.env")
    if not os.path.exists(env_file):
        return ""
    with open(env_file) as f:
        for line in f:
            if line.startswith(f"{key}="):
                return line.split("=", 1)[1].strip()
    return ""


def _update_env(key: str, value: str) -> None:
    """Write or update .env value."""
    env_file = os.path.expanduser("~/.env")
    lines = []
    found = False
    if os.path.exists(env_file):
        with open(env_file) as f:
            for line in f:
                if line.startswith(f"{key}="):
                    lines.append(f"{key}={value}\n")
                    found = True
                else:
                    lines.append(line)
    if not found:
        lines.append(f"{key}={value}\n")
    with open(env_file, "w") as f:
        f.writelines(lines)


@router.get("/updates")
def get_updates(db: Session = Depends(get_db)) -> UpdatesOut:
    """Get current update status."""
    channel = _env_value("UPDATE_CHANNEL") or "stable"
    last_result = _env_value("UPDATE_LAST_RESULT")

    # Major version check: if current is 2.x and 3 exists, show 3 as available
    major_available = None
    current_major = int(__version__.split(".")[0])
    if current_major < 3:
        major_available = "3"

    return UpdatesOut(
        version=__version__,
        channel=channel,
        last_result=last_result if last_result else None,
        major_available=major_available,
    )


@router.patch("/updates")
def patch_updates(body: UpdatesPatch, db: Session = Depends(get_db)) -> UpdatesOut:
    """Update settings or trigger update pull."""
    if body.channel is not None:
        if body.channel not in {"stable", "eval", "off"}:
            raise HTTPException(400, "Channel must be 'stable', 'eval', or 'off'")
        _update_env("UPDATE_CHANNEL", body.channel)

    if body.pull_major is not None:
        current = int(__version__.split(".")[0])
        requested = int(body.pull_major)
        if requested <= current:
            raise HTTPException(400, f"Major version {requested} not available")
        _update_env("TASK4CE_TAG", f":{requested}")
        trigger(force=True)

    return get_updates(db)


# Internal endpoints (token-protected, used by updater and reboot hook)


@internal_router.get("/kid-session-active")
async def kid_session_active_check(
    db: Session = Depends(get_db),
    token: str = Depends(require_token),
) -> dict[str, bool]:
    """Check if any kid session is active (reboot and updater skip hook)."""
    fam = get_family(db)
    from app.models.lock import Device

    active = (
        db.query(Device)
        .filter(Device.family_id == fam.id, Device.kid_session_active == True)
        .first()
        is not None
    )

    return {"active": active}


@internal_router.post("/today-note")
async def post_today_note(
    body: dict[str, str],
    db: Session = Depends(get_db),
    token: str = Depends(require_token),
) -> dict[str, str]:
    """Add a note to the Today page (update status messages, max 256 chars)."""
    fam = get_family(db)
    note = body.get("note", "")[:256]
    if note:
        inbox.notify_parents(db, fam, note)
        db.commit()

    return {"status": "ok"}


@internal_router.post("/telemetry")
async def post_telemetry(
    body: dict[str, str],
    db: Session = Depends(get_db),
    token: str = Depends(require_token),
) -> dict[str, str]:
    """Record telemetry event (e.g. update_failed for eval boxes)."""
    # Telemetry integration via Umami; for now, just acknowledge
    event = body.get("event", "")
    if event == "update_failed":
        pass  # Future: log to telemetry system

    return {"status": "recorded"}
