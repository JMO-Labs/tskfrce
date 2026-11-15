"""Auto-relink a kid's phone that reconnects with a new private (random) MAC."""

from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from app.lock.fingerbank import os_family
from app.lock.hints import _kinds, inherit
from app.lock.state import desired_blocked
from app.models.family import get_family
from app.models.lock import Device, DeviceHintRejection, Override
from app.services import inbox

WINDOW = timedelta(minutes=10)
SCAN_INTERVAL = timedelta(seconds=20)
MIN_SILENCE = 2 * SCAN_INTERVAL  # an online device is never a candidate
RECENT = timedelta(seconds=60)  # a paused device silent this recently makes a newcomer suspect


def _conflict(a: Device, b: Device) -> bool:
    """True when both sides know a fingerprint field and the values differ (or OS families differ)."""
    for k in ("vendor", "dhcp_fp", "mdns_name", "model"):
        x, y = getattr(a, k), getattr(b, k)
        if x and y and x.lower() != y.lower():
            return True
    fa, fb = os_family(a.device_class), os_family(b.device_class)
    return bool(fa and fb and fa != fb)


def _candidates(db: Session, device: Device, now: datetime, silence: timedelta) -> list[Device]:
    """Assigned private-MAC devices on `device`'s network that `device` could be a rotation of."""
    rejected = {
        c for (c,) in db.query(DeviceHintRejection.candidate_id).filter_by(device_id=device.id)
    }
    return [
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
        and now - c.last_seen >= silence
        and timedelta(0) <= device.first_seen - c.last_seen <= WINDOW
        and not (c.hint_reason == "relink" and now - c.first_seen <= WINDOW)  # no chains
        and not _conflict(device, c)
    ]


def provisional_pause(db: Session, device: Device) -> bool:
    """Start a new private device paused when a paused kid device went silent moments ago."""
    if device.status != "unassigned" or not device.random_mac:
        return False
    now = datetime.now(UTC).replace(tzinfo=None)
    near = [c for c in _candidates(db, device, now, timedelta(0)) if now - c.last_seen <= RECENT]
    if not near:
        return False
    paused = set(desired_blocked(db, datetime.now(UTC)))
    if not any(c.mac in paused for c in near):
        return False
    device.held = device.held_provisional = True
    return True


def settle_provisional(db: Session, device: Device) -> None:
    """Drop a provisional pause once relink linked the device, a parent acted, or it is ruled out."""
    if not device.held_provisional:
        return
    now = datetime.now(UTC).replace(tzinfo=None)
    if device.status != "unassigned" or not device.held:  # linked, assigned or allowed
        device.held = False
    elif (
        now - device.first_seen <= WINDOW
        and any(c.last_seen <= device.first_seen for c in _candidates(db, device, now, timedelta(0)))
    ):
        return  # still a plausible relink
    else:
        device.held = bool(get_family(db).hold_private_devices and device.random_mac)
    device.held_provisional = False


def apply_relink(db: Session, device: Device) -> bool:
    """Link `device` to a silent assigned private-MAC device on the same network. Caller commits."""
    if device.status != "unassigned" or device.hint_of_id is not None or not device.random_mac:
        return False
    now = datetime.now(UTC).replace(tzinfo=None)
    cands = _candidates(db, device, now, MIN_SILENCE)
    if len(cands) > 1:
        fam = get_family(db)
        fam.hold_private_hint = True  # powers the one-time "hold new private devices?" card
    if len(cands) != 1:  # none, or ambiguous: leave it to the "is this X?" hint
        return False
    cand = cands[0]
    inherit(db, device, cand, "relink")
    device.held = device.held_provisional = False
    cand.replaced = True
    inbox.notify(
        db,
        inbox.parents(db),
        "device_hint",
        f"{cand.name} reconnected with a new address",
        f"We kept its rules. {_kinds(device, cand)}Not the same device? Undo.",
        device_id=device.id,
    )
    return True


def undo_if_reappeared(db: Session, device: Device) -> bool:
    """A `replaced` device is back: undo the relink that hid it. Caller commits."""
    if not device.replaced:
        return False
    device.replaced = False
    cutoff = datetime.now(UTC).replace(tzinfo=None) - WINDOW  # older links may be parent-confirmed
    linked = db.query(Device).filter(
        Device.hint_of_id == device.id,
        Device.hint_reason == "relink",
        Device.first_seen >= cutoff,
    )
    for new in linked:
        db.merge(DeviceHintRejection(device_id=new.id, candidate_id=device.id))
        new.owners, new.groups = [], []
        db.query(Override).filter(Override.device_id == new.id).delete()
        new.status = "unassigned"
        new.hint_of_id = new.hint_reason = None
        inbox.notify(
            db,
            inbox.parents(db),
            "device_hint",
            f"{device.name} came back with its old address",
            "We undid the link. Say whose the other device is.",
            device_id=new.id,
        )
    return True
