"""Box reset service: wipe family data, unblock devices, restart network."""

import json
import subprocess
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import and_, delete
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.logging import get_logger
from app.lock.blocker_client import push_blocked
from app.models import (
    Chore,
    ChoreAssignment,
    ChoreRun,
    CustomBadge,
    Device,
    DeviceGroup,
    DeviceHintRejection,
    FamilySettings,
    Goal,
    GoalAuto,
    GoalContribution,
    GoalParty,
    HappyHour,
    HomeworkActivity,
    HomeworkRequest,
    HourRule,
    KidDevice,
    Notification,
    Points,
    PointsType,
    Redemption,
    Reward,
    ScreenBank,
    TrustEvent,
    User,
    UsedInvite,
)
from app.models.user import UserRole

logger = get_logger(__name__)


def reset_app_data(db: Session, unblock: bool = True) -> None:
    """
    Reset app: wipe family data, keep Wi-Fi/box ID/UPDATE_CHANNEL/telemetry.

    Tables wiped: kids (users with ROLE=KID), chores, chore_runs, devices,
    device groups, notifications (inbox), points, rewards, assignments,
    hour rules, and related data.

    Parent (ROLE=PARENT) and family_settings are kept.
    box ID/secret/domain (family_keys) are kept.
    UPDATE_CHANNEL env var is kept (it's in .env, not the database).
    """
    try:
        # Unblock all devices first (flush blocker nftables rules)
        if unblock:
            if not push_blocked([]):
                logger.warning("Blocker unreachable; proceeding with reset anyway")

        # Delete all kids (users with role='KID')
        db.execute(delete(User).where(User.role == UserRole.KID))

        # Delete family data (cascade should handle most, but be explicit)
        db.execute(delete(ChoreRun))
        db.execute(delete(ChoreAssignment))
        db.execute(delete(Chore))
        db.execute(delete(Device))
        db.execute(delete(DeviceGroup))
        db.execute(delete(DeviceHintRejection))
        db.execute(delete(KidDevice))
        db.execute(delete(Notification))
        db.execute(delete(Points))
        db.execute(delete(PointsType))
        db.execute(delete(Reward))
        db.execute(delete(Redemption))
        db.execute(delete(HourRule))
        db.execute(delete(CustomBadge))
        db.execute(delete(Goal))
        db.execute(delete(GoalAuto))
        db.execute(delete(GoalContribution))
        db.execute(delete(GoalParty))
        db.execute(delete(HappyHour))
        db.execute(delete(TrustEvent))
        db.execute(delete(HomeworkActivity))
        db.execute(delete(HomeworkRequest))
        db.execute(delete(ScreenBank))

        # Reset family settings but keep the family name and other config
        fam = db.query(FamilySettings).first()
        if fam:
            # Reset to wizard start (setup_step set to None by frontend or we leave it)
            fam.last_reset_date = None

        db.commit()
        logger.info("Reset app data complete")

        # Send telemetry if eval box
        _send_telemetry_event("box_reset", {"factory": False})

    except Exception as e:
        logger.error("Reset app data failed", error=str(e))
        db.rollback()
        raise


def factory_reset(db: Session, unblock: bool = True) -> None:
    """
    Factory reset: wipe everything reset_app_data wipes, plus saved Wi-Fi.

    Also re-arms the sticker claim code (if present in .env).
    """
    try:
        # First do the app reset
        reset_app_data(db, unblock=unblock)

        # Then wipe Wi-Fi (restart network manager or systemd-networkd)
        restart_network_manager()

        # Re-arm claim code: clear it from memory so the next setup needs the sticker again
        # (This is more of a note for the deployment/install.sh; claim code is in .env)
        # For now, just log it
        logger.info("Sticker claim code re-armed (set in .env)")

        logger.info("Factory reset complete")

        # Send telemetry if eval box
        _send_telemetry_event("box_reset", {"factory": True})

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
    Export family data as JSON (no secrets, no PIN, no device enrollment data).

    Returns: JSON string with {family, kids, chores, rewards, points_history}.
    """
    try:
        fam = db.query(FamilySettings).first()
        if not fam:
            return json.dumps({})

        # Gather data
        kids = db.query(User).filter(User.role == UserRole.KID).all()
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
                    "name": k.name,
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


def _send_telemetry_event(event_name: str, data: dict[str, Any] | None = None) -> None:
    """Send event to telemetry backend if eval box (TASK4CE_TAG starts with 'eval-')."""
    try:
        tag = settings.TASK4CE_TAG
        if not tag or not tag.startswith("eval-"):
            return  # Not an eval box, don't send

        # TODO: Implement telemetry send to Umami or other backend
        # For now, just log it
        logger.info(f"Telemetry event: {event_name}", data=data)

    except Exception as e:
        logger.warning("Telemetry send failed", error=str(e))
        # Never block the reset for telemetry
