"""Box reset service: wipe family data, unblock devices, restart network."""

import json
import subprocess
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import delete, text
from sqlalchemy.orm import Session

from app.core.database import Base
from app.core.logging import get_logger
from app.lock.blocker_client import push_state
from app.models import FamilySettings, User
from app.models.user import UserRole

logger = get_logger(__name__)

# Tables to KEEP (not wiped): box identity, settings, config, DENYLIST only
# Everything else is wiped. KEEP ONLY denylists (prevent replay).
# DELETE live credentials: kid_enroll_tokens, pending_invites, password_reset.
# Token_epoch invalidates old JWTs (no need to keep them).
KEEP_TABLES = {
    "family_settings",  # family name, timezone, config, token_epoch
    "family_keys",  # box ID, secret, domain
    "used_invites",  # DENYLIST: prevent replayed invite tokens
    "alembic_version",  # migration tracking
}


def reset_app_data(db: Session, unblock: bool = True) -> str | None:
    """
    Reset app: wipe family data (kids, chores, history, parent PIN).
    Keep box ID/domain, UPDATE_CHANNEL, telemetry config.

    Order: unblock devices → wipe data → caller handles restart.

    Parent user (ROLE=PARENT) is deleted so setup wizard is reachable again
    (claim code re-armed if factory reset).

    Returns: setup_token (for unclaimed boxes without CLAIM_CODE), or None.
    """
    setup_token = None
    try:
        # Unblock all devices first (flush blocker nftables rules)
        if unblock:
            if not push_state([], {}):
                logger.warning("Blocker unreachable; proceeding with reset anyway")

        # Reset family settings fields FIRST (before deleting users)
        # This clears foreign key references
        fam = db.query(FamilySettings).first()
        if fam:
            fam.owner_id = None  # Re-arm claim code for setup
            fam.last_reset_date = None
            fam.setup_step = None  # Wizard starts fresh

            # Bump token_epoch to invalidate all old JWTs (security)
            fam.token_epoch = (fam.token_epoch or 0) + 1

            # For unclaimed boxes (no CLAIM_CODE), generate setup token
            from app.core.config import settings

            if not settings.CLAIM_CODE:
                import secrets

                setup_token = secrets.token_urlsafe(32)
                # TODO: Store setup_token in a new table for one-use validation

            db.commit()

        # Disable FK constraints temporarily (SQLite only; Postgres auto-handles with CASCADE)
        sqlite = db.get_bind().dialect.name == "sqlite"
        if sqlite:
            db.execute(text("PRAGMA foreign_keys=OFF"))

        # Delete all family data except KEEP_TABLES
        # Iterate sorted_tables in reverse to respect dependency order
        for table in reversed(Base.metadata.sorted_tables):
            if table.name not in KEEP_TABLES:
                db.execute(delete(table))

        # Re-enable FK constraints
        if sqlite:
            db.execute(text("PRAGMA foreign_keys=ON"))

        db.commit()
        logger.info("Reset app data complete")

        # Telemetry: use eval-branch hooks when available
        # For now, log the intent (actual send deferred to telemetry integration)
        _log_telemetry_intent("box_reset", {"factory": False})

        return setup_token

    except Exception as e:
        logger.error("Reset app data failed", error=str(e))
        db.rollback()
        raise


def factory_reset(db: Session, unblock: bool = True) -> str | None:
    """
    Factory reset: wipe everything reset_app_data wipes, plus saved Wi-Fi.
    Re-arms the sticker claim code for setup (on next boot).

    Returns: setup_token for unclaimed boxes, or None.
    """
    try:
        # First do the app reset
        setup_token = reset_app_data(db, unblock=unblock)

        # Then wipe Wi-Fi (restart network manager or systemd-networkd)
        restart_network_manager()

        # Sticker claim code is re-armed by setting owner_id=None in reset_app_data
        logger.info("Factory reset complete")

        # Telemetry: use eval-branch hooks when available
        _log_telemetry_intent("box_reset", {"factory": True})

        return setup_token

    except Exception as e:
        logger.error("Factory reset failed", error=str(e))
        raise


def restart_network_manager() -> None:
    """Restart networkd or NetworkManager to forget saved Wi-Fi."""
    try:
        # Try systemd-networkd first (default on beta box)
        subprocess.run(
            ["sudo", "systemctl", "restart", "systemd-networkd"],
            timeout=10,
            check=False,
            capture_output=True,
        )
        logger.info("Restarted systemd-networkd")
    except Exception as e:
        logger.warning("systemd-networkd restart failed", error=str(e))

        # Fallback: try NetworkManager if installed
        try:
            subprocess.run(
                ["sudo", "systemctl", "restart", "NetworkManager"],
                timeout=10,
                check=False,
                capture_output=True,
            )
            logger.info("Restarted NetworkManager")
        except Exception as e2:
            logger.warning("NetworkManager restart also failed", error=str(e2))


def backup_export(db: Session) -> str:
    """
    Export family data as JSON (no secrets, no PIN, no device enrollment).

    Returns: JSON string with {family, kids, chores, rewards, points_history}.
    """
    try:
        fam = db.query(FamilySettings).first()
        if not fam:
            return json.dumps({})

        # Gather data
        kids = db.query(User).filter(User.role == UserRole.KID).all()
        from app.models import Chore, Points, Reward

        chores = db.query(Chore).all()
        rewards = db.query(Reward).all()
        points = db.query(Points).all()

        export: dict[str, Any] = {
            "exported_at": datetime.now(UTC).isoformat(),
            "family": {
                "name": fam.name,
                "timezone": fam.timezone,
                "reset_time": fam.reset_time,
            },
            "kids": [
                {
                    "id": k.id,
                    "name": k.full_name,
                    "email": k.email,
                    "role": k.role,
                }
                for k in kids
            ],
            "chores": [
                {
                    "id": c.id,
                    "name": c.name,
                    "category": c.category,
                }
                for c in chores
            ],
            "rewards": [
                {
                    "id": r.id,
                    "name": r.name,
                    "price": r.price,
                }
                for r in rewards
            ],
            "points_history": [
                {
                    "id": p.id,
                    "kid_id": p.kid_id,
                    "amount": p.amount,
                    "reason": p.reason,
                    "created_at": p.created_at.isoformat() if p.created_at else None,
                }
                for p in points
            ],
        }

        return json.dumps(export, indent=2)

    except Exception as e:
        logger.error("Backup export failed", error=str(e))
        return json.dumps({"error": str(e)})


def _log_telemetry_intent(event_name: str, data: dict[str, Any] | None = None) -> None:
    """
    Log intent for telemetry (actual send via eval-branch hooks).

    When eval-telemetry branch is merged, replace this with actual send.
    Check: TASK4CE_TAG env var for eval- prefix, or use the eval-branch
    telemetry hooks (see docs/superpowers/plans/2026-10-25-eval-telemetry.md).
    """
    logger.info(f"Telemetry intent: {event_name}", data=data)
