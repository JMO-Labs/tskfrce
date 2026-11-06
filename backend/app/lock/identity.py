"""Spot a device whose self-reported identity changed (a copied Wi-Fi address). Caller commits."""

from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.lock import activity
from app.models.device_activity import DeviceEvent
from app.models.lock import Device
from app.services import inbox

# Model strings are device-supplied: never echo them in an alert (raw values stay in the event).
BODY = "Its reported device type changed. Someone may have copied its address. Tap to check."


def _recently_alerted(db: Session, dev: Device, now: datetime) -> bool:
    return (
        db.query(DeviceEvent.id)
        .filter(
            DeviceEvent.device_id == dev.id,
            DeviceEvent.kind == "identity_change",
            DeviceEvent.reason == "alerted",
            DeviceEvent.at >= now - timedelta(hours=24),
        )
        .first()
        is not None
    )


def _differs(old: str | None, new: str | None) -> bool:
    return bool(old and new and old.lower() != new.lower())


def note_identity_change(
    db: Session, dev: Device, old_model: str | None, _old_fp: str | None, now: datetime
) -> None:
    if dev.status != "assigned":
        return
    if _differs(old_model, dev.model):
        # throttle on alerts actually sent, so changes every <24 h can't keep it quiet forever
        alert = not _recently_alerted(db, dev, now)
        detail = f"{old_model} → {dev.model}"[:120]
        activity.log(
            db, dev.id, "identity_change", now, detail=detail, reason="alerted" if alert else None
        )
        if alert:
            inbox.notify_parents(
                db,
                "device_bypass",
                f"{dev.name} may be a different device",
                BODY,
                device_id=dev.id,
            )
