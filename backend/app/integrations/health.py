"""Per-integration health: count failures, auto-pause, and cap outbound calls."""

import logging
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
log = logging.getLogger(__name__)

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
    if install.failures >= FAIL_LIMIT:
        pause(db, install, reason)


def pause(db: Session, install: IntegrationInstall, reason: str) -> None:
    """Pause an active install, drop its cached widgets and tell parents once. Caller commits."""
    if install.status != "active":
        return
    install.status = "paused"
    install.paused_reason = reason[:200]
    from app.integrations import widget_service  # widget_service imports health

    widget_service.forget(install.id)
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
    """Run fn on the install's client. None if paused, rate-limited or failed. Nothing raises:
    a bad stored manifest or an unreadable secret counts as an "internal error" failure, so one
    broken install never breaks a feed that lists the others."""
    if install.status != "active" or not _allowed(install):
        return None
    try:
        out = fn(store.client_for(db, install))
    except (BlockedError, FetchError, ProtocolError) as e:
        fail(db, install, _reason(e))
        return None
    except Exception:
        log.exception("Integration %s call failed", install.id)
        fail(db, install, "internal error")
        return None
    ok(install)
    return out
