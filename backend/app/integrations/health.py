"""Per-integration health: count failures, auto-pause, and cap outbound calls."""

from collections.abc import Callable
from typing import TypeVar

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core import ratelimit
from app.integrations import store
from app.integrations.client import BoxClient, ProtocolError
from app.integrations.net import BlockedError, FetchError
from app.models.integration import IntegrationInstall
from app.services import inbox

T = TypeVar("T")

FAIL_LIMIT = 5
OUTBOUND_PER_MIN = 30


def _allowed(install: IntegrationInstall) -> bool:
    key = f"int-out:{install.id}"
    try:
        ratelimit.check(key, OUTBOUND_PER_MIN, 60)
    except HTTPException:
        return False
    ratelimit.hit(key, 60)
    return True


def ok(install: IntegrationInstall) -> None:
    install.failures = 0


def fail(db: Session, install: IntegrationInstall, reason: str) -> None:
    """Count a failure; at the limit pause once and tell parents. Caller commits."""
    install.failures = (install.failures or 0) + 1
    if install.failures >= FAIL_LIMIT and install.status == "active":
        install.status = "paused"
        install.paused_reason = reason[:200]
        inbox.notify_parents(
            db,
            "integration_paused",
            f"{install.name} is paused",
            "It stopped answering properly. Open it to try again.",
        )


def _reason(e: Exception) -> str:
    msg = str(e)
    if isinstance(e, BlockedError) or (isinstance(e, ProtocolError) and msg == "blocked"):
        return "blocked address"
    if isinstance(e, FetchError) or (isinstance(e, ProtocolError) and msg == "timeout"):
        return "timed out" if msg == "timeout" else "not reachable"
    return "bad signature" if "signature" in msg else "bad reply"


def guarded_call(
    db: Session, install: IntegrationInstall, fn: Callable[[BoxClient], T]
) -> T | None:
    """Run fn on the install's client. None if paused, rate-limited or failed."""
    if install.status != "active" or not _allowed(install):
        return None
    try:
        out = fn(store.client_for(db, install))
    except (BlockedError, FetchError, ProtocolError) as e:
        fail(db, install, _reason(e))
        return None
    ok(install)
    return out
