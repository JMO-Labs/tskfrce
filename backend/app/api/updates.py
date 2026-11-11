"""Box updates: version, channel, and upgrade management."""

import json
import os
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app import __version__
from app.api.deps import get_db, require_parent
from app.api.internal import require_token
from app.services import inbox

router = APIRouter(prefix="/api/v1", tags=["updates"], dependencies=[Depends(require_parent)])


class UpdatesOut(BaseModel):
    """Current update status and settings."""

    version: str
    channel: str
    last_result: str | None
    last_version: str | None
    major_available: str | None


class UpdatesPatch(BaseModel):
    """Update settings changes."""

    channel: str | None = None
    pull_major: str | None = None


def _state_file() -> Path:
    """Get update state file path ($DIR/data/update-state.json from settings or env)."""
    try:
        # Try settings first (configured data dir)
        data_dir = os.environ.get("DATA_DIR") or os.environ.get("TASK4CE_DATA_DIR")
        if data_dir:
            return Path(data_dir) / "update-state.json"
    except Exception:
        pass
    # Fallback
    return Path("/app/data/update-state.json")


def _read_state() -> dict:
    """Read update state from JSON file."""
    try:
        path = _state_file()
        if path.exists():
            return json.loads(path.read_text())
    except Exception:
        pass
    # Default state defaults channel to install-time channel (defense in depth)
    install_ch = _get_install_channel()
    return {
        "channel": install_ch,
        "auto": True,
        "last_result": None,
        "last_version": None,
        "major_available": None,
        "requested_major": None,
    }


def _write_state(data: dict, install_channel: str | None = None) -> None:
    """Write update state with eval→stable guard (defense in depth).

    If install channel is eval, reject writes of stable or requested_major.
    """
    if install_channel is None:
        install_channel = _get_install_channel()

    # Guard: eval installs cannot have stable channel or major pull
    # But respect "off" channel (user can disable updates)
    if install_channel == "eval":
        if data.get("channel") == "stable":
            raise ValueError("Eval channel cannot write stable channel")
        if data.get("requested_major"):
            raise ValueError("Eval channel cannot request major version")
        # Only coerce non-eval/off values to eval
        if data.get("channel") not in {"eval", "off"}:
            data["channel"] = "eval"

    try:
        path = _state_file()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, indent=2))
    except Exception:
        pass


def _get_install_channel() -> str:
    """Install-time channel, passed in by compose from the host .env (immutable at runtime)."""
    # ponytail: env var, not a file read; the container never sees the host .env
    ch = os.environ.get("UPDATE_CHANNEL", "").strip()
    return ch if ch in {"stable", "eval", "off"} else "stable"


@router.get("/updates")
def get_updates(db: Session = Depends(get_db)) -> UpdatesOut:
    """Get current update status."""
    state = _read_state()
    install_channel = _get_install_channel()

    return UpdatesOut(
        version=__version__,
        channel=state.get("channel", install_channel),
        last_result=state.get("last_result"),
        last_version=state.get("last_version"),
        major_available=state.get("major_available"),
    )


@router.patch("/updates")
def patch_updates(body: UpdatesPatch, db: Session = Depends(get_db)) -> UpdatesOut:
    """Update settings or trigger update pull."""
    state = _read_state()
    install_channel = _get_install_channel()

    # Guard: eval boxes cannot pull major versions
    if body.pull_major is not None:
        if install_channel == "eval":
            raise HTTPException(409, "Eval channel cannot pull major versions")
        current = int(__version__.split(".")[0])
        requested = int(body.pull_major)
        if requested <= current:
            raise HTTPException(400, f"Major version {requested} not available")
        state["requested_major"] = requested
        # ponytail: picked up by the next nightly run; a "now" button needs a host trigger
        _write_state(state, install_channel)

    if body.channel is not None:
        # Guard: eval install cannot switch to stable
        if install_channel == "eval" and body.channel == "stable":
            raise HTTPException(409, "Eval channel cannot switch to stable")
        if body.channel not in {"stable", "eval", "off"}:
            raise HTTPException(400, "Channel must be 'stable', 'eval', or 'off'")
        state["channel"] = body.channel
        _write_state(state, install_channel)

    return get_updates(db)


# Internal endpoints (token-protected, used by updater and reboot hook)


# Set up internal router with token auth
internal_router_with_auth = APIRouter(
    prefix="/internal",
    tags=["updates-internal"],
    dependencies=[Depends(require_token)],
)


@internal_router_with_auth.get("/kid-session-active")
async def kid_session_active_check(db: Session = Depends(get_db)) -> dict[str, bool]:
    """True while any timed override (unlock, lock, homework, penalty) is still running.

    The host updater and the pre-reboot hook skip the night rather than restart mid-timer.
    """
    from datetime import UTC, datetime

    from app.models.lock import Override

    now = datetime.now(UTC).replace(tzinfo=None)
    active = db.query(Override.id).filter(Override.expires_at > now).first() is not None
    return {"active": active}


@internal_router_with_auth.get("/update-state")
def internal_update_state() -> dict:
    """What the host updater should do tonight. The eval guard is applied here too."""
    state = _read_state()
    install = _get_install_channel()
    channel = state.get("channel") or install
    if install == "eval" and channel not in {"eval", "off"}:
        channel = "eval"
    if not state.get("auto", True):
        channel = "off"
    major = state.get("requested_major") if install != "eval" else None
    return {"channel": channel, "requested_major": major}


class UpdateResult(BaseModel):
    result: Literal["success", "failed"]
    version: str = Field(default="", max_length=40)
    old_version: str = Field(default="", max_length=40)


@internal_router_with_auth.post("/update-result")
def internal_update_result(body: UpdateResult, db: Session = Depends(get_db)) -> dict:
    """Record the night's result and tell the parents (Today bell + ping)."""
    state = _read_state()
    state["last_result"] = body.result
    if body.result == "success":
        state["last_version"] = body.version
        state["requested_major"] = None
        title = f"Updated to {body.version}" if body.version else "Box updated"
    else:
        title = f"Update to {body.version or 'the new version'} failed"
        body_text = f"Still on {body.old_version or 'the current version'}. Will retry tomorrow."
    _write_state(state)
    inbox.notify_parents(db, "box_update", title, None if body.result == "success" else body_text)
    db.commit()
    return {"status": "ok"}
