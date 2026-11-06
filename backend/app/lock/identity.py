"""Spot a device whose self-reported identity changed (a copied Wi-Fi address). Caller commits."""

from datetime import datetime

from sqlalchemy.orm import Session

from app.lock import activity
from app.models.lock import Device
from app.services import inbox


def _differs(old: str | None, new: str | None) -> bool:
    return bool(old and new and old.lower() != new.lower())


def note_identity_change(
    db: Session, dev: Device, old_model: str | None, old_fp: str | None, now: datetime
) -> None:
    if dev.status != "assigned":
        return
    if _differs(old_model, dev.model):
        activity.log(db, dev.id, "identity_change", now, detail=f"{old_model} → {dev.model}"[:120])
        inbox.notify_parents(
            db,
            "device_bypass",
            f"{dev.name} may be a different device",
            f"It now says it's a {dev.model}, not a {old_model}. "
            "Someone may have copied its address. Tap to check.",
            device_id=dev.id,
        )
    elif _differs(old_fp, dev.dhcp_fp):
        activity.log(db, dev.id, "identity_change", now, detail="fingerprint")
