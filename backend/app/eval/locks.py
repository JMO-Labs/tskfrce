"""Lock reasons per device and transitions seen by the lock loop."""

from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.eval import listeners, store
from app.lock.rules import DeviceFacts
from app.lock.schedule import in_window, local_now
from app.lock.state import Prefetch, device_facts
from app.models.family import get_family
from app.models.lock import Device

_last: dict[int, str | None] | None = None


def reason(f: DeviceFacts, now_local: datetime) -> str | None:
    """Why a device is offline; mirrors rules.is_online branch by branch (None = online)."""
    if f.override == "lock":
        return "override"
    if f.status == "guest":
        return None
    if f.status == "unassigned":
        return None if f.override == "unlock" or not f.new_devices_blocked else "new_device"
    if not all(any(in_window(w, now_local) for w in s) for s in f.allowed_sets):
        return "hours"
    chores_ok = all(o.total == 0 or o.approved == o.total for o in f.owners)
    if (
        chores_ok
        or any(in_window(w, now_local) for w in f.free)
        or f.override == "unlock"
        or (f.bonus_active and f.points_unlock_early)
    ):
        return None
    return "chores"


def track(db: Session, now_utc: datetime) -> None:
    global _last
    fam = get_family(db)
    now_local = local_now(fam.timezone, now_utc.replace(tzinfo=now_utc.tzinfo or UTC))
    devices = db.query(Device).all()
    pre = Prefetch(db, devices)
    now = {d.id: reason(device_facts(db, d, fam, now_utc, pre), now_local) for d in devices}
    last, _last = _last, now
    if last is None:
        return
    for did, r in now.items():
        if r in ("hours", "chores") and last.get(did) != r:
            store.bump(f"locks_by_{r}")
            listeners.first_event("first_lock")
