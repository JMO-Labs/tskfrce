"""Auto-relink a kid's phone that reconnects with a new private (random) MAC."""

from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from app.lock.fingerbank import os_family
from app.lock.hints import inherit
from app.models.lock import Device, DeviceHintRejection
from app.services import inbox

WINDOW = timedelta(minutes=10)


def _conflict(a: Device, b: Device) -> bool:
    """True when both sides know a fingerprint field and the values differ (or OS families differ)."""
    for k in ("vendor", "dhcp_fp", "mdns_name", "model"):
        x, y = getattr(a, k), getattr(b, k)
        if x and y and x.lower() != y.lower():
            return True
    fa, fb = os_family(a.device_class), os_family(b.device_class)
    return bool(fa and fb and fa != fb)


def apply_relink(db: Session, device: Device) -> bool:
    """Link `device` to a silent assigned private-MAC device on the same network. Caller commits."""
    if device.status != "unassigned" or device.hint_of_id is not None or not device.random_mac:
        return False
    now = datetime.now(UTC).replace(tzinfo=None)
    rejected = {
        c for (c,) in db.query(DeviceHintRejection.candidate_id).filter_by(device_id=device.id)
    }
    cands = [
        c
        for c in db.query(Device).filter(
            Device.id != device.id,
            Device.status == "assigned",
            Device.replaced.is_(False),
            Device.network_id.is_(device.network_id)
            if device.network_id is None
            else Device.network_id == device.network_id,
            Device.vlan_id.is_(device.vlan_id)
            if device.vlan_id is None
            else Device.vlan_id == device.vlan_id,
            Device.last_seen.isnot(None),
        )  # fmt: skip
        if c.random_mac
        and c.id not in rejected
        and timedelta(0) <= device.first_seen - c.last_seen <= WINDOW
        and not _conflict(device, c)
    ]
    if not cands or len({frozenset(o.id for o in c.owners) for c in cands}) > 1:
        return False
    cand = max(cands, key=lambda c: c.last_seen)
    inherit(db, device, cand, "relink")
    cand.replaced = True
    inbox.notify(
        db,
        inbox.parents(db),
        "device_hint",
        f"{cand.name} reconnected with a new address",
        "We kept its rules. Not the same device? Undo.",
        device_id=device.id,
    )
    return True
