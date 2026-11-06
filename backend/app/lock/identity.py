"""Spot a device whose self-reported identity changed (a copied Wi-Fi address). Caller commits."""

import re
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.lock import activity
from app.models.device_activity import DeviceEvent
from app.models.lock import Device
from app.services import inbox

SAFE_MODEL = re.compile(r"[A-Za-z0-9 ,._()-]{1,40}")
GENERIC = "Its reported device type changed. Someone may have copied its address. Tap to check."


def _recently_alerted(db: Session, dev: Device, now: datetime) -> bool:
    return (
        db.query(DeviceEvent.id)
        .filter(
            DeviceEvent.device_id == dev.id,
            DeviceEvent.kind == "identity_change",
            DeviceEvent.detail != "fingerprint",
            DeviceEvent.at >= now - timedelta(hours=24),
        )
        .first()
        is not None
    )


def _body(old: str, new: str) -> str:
    # model strings come from the device itself; only echo plain ones
    if SAFE_MODEL.fullmatch(old) and SAFE_MODEL.fullmatch(new):
        return (
            f"It now says it's a {new}, not a {old}. Someone may have copied its address. "
            "Tap to check."
        )
    return GENERIC


def _differs(old: str | None, new: str | None) -> bool:
    return bool(old and new and old.lower() != new.lower())


def note_identity_change(
    db: Session, dev: Device, old_model: str | None, old_fp: str | None, now: datetime
) -> None:
    if dev.status != "assigned":
        return
    if _differs(old_model, dev.model):
        quiet = _recently_alerted(db, dev, now)  # check before logging this one
        activity.log(db, dev.id, "identity_change", now, detail=f"{old_model} → {dev.model}"[:120])
        if not quiet:
            inbox.notify_parents(
                db,
                "device_bypass",
                f"{dev.name} may be a different device",
                _body(old_model, dev.model),
                device_id=dev.id,
            )
    elif _differs(old_fp, dev.dhcp_fp):
        activity.log(db, dev.id, "identity_change", now, detail="fingerprint")
