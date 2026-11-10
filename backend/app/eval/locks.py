"""Lock reasons per device and transitions seen by the lock loop."""

from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.eval import listeners, store
from app.lock.rules import DeviceFacts, block_reason
from app.lock.schedule import local_now
from app.lock.state import Prefetch, device_facts
from app.models.family import get_family
from app.models.lock import Device

_last: dict[int, str | None] | None = None


# the app's block reasons, in the names the eval counters use
_NAMES = {"manual": "override", "schedule": "hours"}


def reason(f: DeviceFacts, now_local: datetime) -> str | None:
    """Why a device is offline (None = online); the lock rules' own answer, renamed."""
    r = block_reason(f, now_local)
    return _NAMES.get(r, r)


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
