"""Match a new device to a kid's device that just went quiet (private-address churn)."""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from app.lock.state import desired_blocked
from app.models.lock import Device, DeviceHintRejection, Override
from app.models.user import UserRole
from app.services import inbox

OVERLAP = timedelta(minutes=2)
WINDOW = timedelta(hours=24)
WEAK_GAP = timedelta(minutes=30)
STRONG, MEDIUM, WEAK = 3, 2, 1
REASON = {STRONG: "name", MEDIUM: "model", WEAK: "timing"}


@dataclass(frozen=True)
class DeviceSignals:
    id: int
    mac: str
    first_seen: datetime  # naive UTC
    last_seen: datetime | None
    owner_ids: frozenset[int]
    mdns_name: str | None = None
    model: str | None = None
    dhcp_fp: str | None = None

    @property
    def random_mac(self) -> bool:
        return bool(int(self.mac[:2], 16) & 0x02)


@dataclass(frozen=True)
class Hint:
    candidate_id: int
    reason: str  # name | model | timing


def _strength(new: DeviceSignals, c: DeviceSignals, paused_ids: set[int]) -> int:
    if new.mdns_name and (c.mdns_name or "").lower() == new.mdns_name.lower():
        return STRONG
    if new.model and new.dhcp_fp and (c.model, c.dhcp_fp) == (new.model, new.dhcp_fp):
        return MEDIUM
    if (
        new.random_mac
        and new.dhcp_fp
        and c.dhcp_fp == new.dhcp_fp
        and new.first_seen - c.last_seen <= WEAK_GAP
        and c.id in paused_ids
    ):
        return WEAK
    return 0


def find_hint(
    new: DeviceSignals,
    candidates: list[DeviceSignals],
    now: datetime,
    paused_ids: set[int],
    rejected: set[int] | frozenset[int] = frozenset(),
) -> Hint | None:
    scored: list[tuple[int, DeviceSignals]] = []
    for c in candidates:
        if c.id == new.id or c.id in rejected or c.last_seen is None:
            continue
        if now - c.last_seen > WINDOW or c.last_seen > new.first_seen - OVERLAP:
            continue
        if s := _strength(new, c, paused_ids):
            scored.append((s, c))
    if not scored:
        return None
    best = max(s for s, _ in scored)
    top = [c for s, c in scored if s == best]
    if len({c.owner_ids for c in top}) > 1:
        return None
    return Hint(max(top, key=lambda c: c.last_seen).id, REASON[best])


def _signals(d: Device) -> DeviceSignals:
    return DeviceSignals(
        d.id, d.mac, d.first_seen, d.last_seen, frozenset(o.id for o in d.owners),
        d.mdns_name, d.model, d.dhcp_fp,
    )  # fmt: skip


def apply_hint(db: Session, device: Device) -> bool:
    """Give `device` the owners/groups of a matching kid device. Caller commits."""
    if device.status != "unassigned" or device.hint_of_id is not None:
        return False
    now = datetime.now(UTC)
    naive = now.replace(tzinfo=None)
    kids = [
        d
        for d in db.query(Device).filter(Device.id != device.id).all()
        if any(o.role == UserRole.KID for o in d.owners)
    ]
    rejected = {
        c for (c,) in db.query(DeviceHintRejection.candidate_id).filter_by(device_id=device.id)
    }
    blocked = set(desired_blocked(db, now))
    paused = {d.id for d in kids if d.mac in blocked}
    hint = find_hint(_signals(device), [_signals(d) for d in kids], naive, paused, rejected)
    if hint is None:
        return False
    cand = next(d for d in kids if d.id == hint.candidate_id)
    device.owners = list(cand.owners)
    device.groups = list(cand.groups)
    device.status = "assigned"
    device.hint_of_id, device.hint_reason = cand.id, hint.reason
    lock = (
        db.query(Override)
        .filter(Override.device_id == cand.id, Override.source == "manual")
        .order_by(Override.created_at.desc(), Override.id.desc())
        .first()
    )
    if lock and lock.action == "lock" and (lock.expires_at is None or lock.expires_at > naive):
        db.add(
            Override(
                device_id=device.id,
                action="lock",
                source="manual",
                expires_at=lock.expires_at,
                created_at=naive,
                created_by_id=lock.created_by_id,
            )
        )
    names = " and ".join(o.full_name or o.username for o in device.owners)
    inbox.notify(
        db,
        inbox.parents(db),
        "device_hint",
        f"{cand.name} came back with a new address",
        f"We gave it {names}'s rules. Not the same device? Undo.",
        device_id=device.id,
    )
    return True
