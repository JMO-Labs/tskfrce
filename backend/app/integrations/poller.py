"""Poll each active catalog install at its own manifest interval (never under 60 s)."""

import json
import logging
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.integrations import health
from app.integrations.apply import apply_actions
from app.integrations.manifest import load_manifest
from app.models.integration import IntegrationInstall

log = logging.getLogger(__name__)
MAX_PER_TICK = 10
MIN_INTERVAL = 60


def interval(install: IntegrationInstall) -> int:
    """Seconds between polls; raises on a manifest that no longer verifies."""
    m = load_manifest(json.loads(install.manifest or ""))
    return max(MIN_INTERVAL, m.poll_seconds or MIN_INTERVAL)


def _poll(db: Session, install: IntegrationInstall, now: datetime) -> None:
    try:
        secs = interval(install)
    except Exception:
        health.pause(db, install, "bad manifest")
        install.next_poll_at = now + timedelta(seconds=MIN_INTERVAL)
        db.commit()
        return
    install.next_poll_at = now + timedelta(seconds=secs)  # set first: failures reschedule too
    reply = health.guarded_call(db, install, lambda c: c.poll())
    if reply is not None:
        apply_actions(db, install, reply.actions)
    db.commit()


def poll_due(db: Session, now: datetime) -> None:
    """Loop step. Each call is bounded by the client's 5 s timeout; at most MAX_PER_TICK."""
    ids = [
        i
        for (i,) in db.query(IntegrationInstall.id)
        .filter(
            IntegrationInstall.status == "active",
            IntegrationInstall.source == "catalog",
            IntegrationInstall.next_poll_at.is_not(None),
            IntegrationInstall.next_poll_at <= now,
        )
        .order_by(IntegrationInstall.next_poll_at, IntegrationInstall.id)
        .limit(MAX_PER_TICK)
    ]
    for install_id in ids:  # one broken install must not starve the others
        try:
            install = db.get(IntegrationInstall, install_id)
            if install is not None and install.status == "active":
                _poll(db, install, now)
        except Exception:
            db.rollback()
            log.exception("Poll of integration %s failed", install_id)
            _reschedule_failed(db, install_id, now)


def _reschedule_failed(db: Session, install_id: int, now: datetime) -> None:
    """The rollback dropped next_poll_at: restore the 60 s floor and count the failure."""
    try:
        install = db.get(IntegrationInstall, install_id)
        if install is not None:
            install.next_poll_at = now + timedelta(seconds=MIN_INTERVAL)
            health.fail(db, install, "bad reply")
            db.commit()
    except Exception:
        db.rollback()
        log.exception("Could not reschedule integration %s", install_id)
