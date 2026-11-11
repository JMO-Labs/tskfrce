"""Box updates: version, channel, and upgrade management."""

import os
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_parent
from app.lock.loop import trigger

router = APIRouter(prefix="/api/v1", tags=["updates"], dependencies=[Depends(require_parent)])


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
    from app import __version__

    channel = _env_value("UPDATE_CHANNEL") or "stable"
    last_result = _env_value("UPDATE_LAST_RESULT")  # not yet set; we store this for future

    # Major version check: if current is 2.x and 3 exists (future), show 3 as available
    major_available = None
    current_major = int(__version__.split(".")[0])
    if current_major < 3:
        major_available = "3"  # ponytail: will check actual availability when needed

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
        # ponytail: simplified; real impl would validate major version exists, then
        # set TASK4CE_TAG to :pull_major and trigger updater immediately
        _update_env("TASK4CE_TAG", f":{body.pull_major}")
        # trigger(force=True) to run updater now
        trigger(force=True)

    return get_updates(db)
