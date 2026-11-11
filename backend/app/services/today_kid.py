"""Per-kid day facts for the Today cards: allowed windows, online minutes, lock reason."""

from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.lock import hours
from app.lock.rules import block_reason
from app.lock.schedule import local_now
from app.lock.state import device_facts
from app.models.device_activity import DevicePresence
from app.models.family import get_family
from app.schemas.lock import utc_z
from app.services import chores as svc

DAY_START, DAY_END = 7 * 60, 21 * 60  # the card timeline: 7am to 9pm, in minutes
SLOT = 10  # presence slot length, minutes
_REASON = {"schedule": "hours", "chores": "chores"}  # anything else a parent/penalty set: manual


def _allowed_windows(db: Session, kid, fam, d: date, pre) -> list[list[int]]:
    """Today's allowed [start, end] minutes for the kid, clipped to the timeline."""
    r = hours.resolve(pre.rules if pre else hours.load(db), {kid.id}, set(), d)
    if not r.allowed_sets and not r.off:
        return [[DAY_START, DAY_END]]
    tz = ZoneInfo(fam.timezone)
    out: list[list[int]] = []
    for m in range(DAY_START, DAY_END):
        t = datetime.combine(d, time(m // 60, m % 60), tzinfo=tz)
        if hours._allowing(r.allowed_sets, r.off, t):
            if out and out[-1][1] == m:
                out[-1][1] = m + 1
            else:
                out.append([m, m + 1])
    return out


def online_slots(db: Session, devices, fam, d: date) -> dict[int, set[int]]:
    """device id -> start minutes (local, today) of its unlocked 10-minute slots: one query."""
    if not devices:
        return {}
    tz = ZoneInfo(fam.timezone)
    start = datetime.combine(d, time(0), tzinfo=tz).astimezone(UTC).replace(tzinfo=None)
    rows = db.query(DevicePresence.device_id, DevicePresence.slot).filter(
        DevicePresence.device_id.in_([x.id for x in devices]),
        DevicePresence.locked.is_(False),
        DevicePresence.slot >= start,
        DevicePresence.slot < start + timedelta(days=1, hours=1),
    )
    out: dict[int, set[int]] = {}
    for did, s in rows:
        loc = s.replace(tzinfo=UTC).astimezone(tz)
        if loc.date() == d:
            out.setdefault(did, set()).add(loc.hour * 60 + loc.minute)
    return out


def _online_minutes(devices, windows, slots) -> int:
    """Distinct slots (a slot counts once across devices) inside the allowed windows."""
    mine = set().union(*(slots.get(x.id, set()) for x in devices)) if devices else set()
    return SLOT * sum(any(a <= m < b for a, b in windows) for m in mine)


def _lock_reason(db: Session, devices, fam, now: datetime, pre) -> str | None:
    """Why the kid is offline now: hours | chores | manual; None unless every device is blocked."""
    if not devices:
        return None
    nl = local_now(fam.timezone, now)
    reasons = [block_reason(device_facts(db, d, fam, now, pre), nl) for d in devices]
    if any(r is None for r in reasons):
        return None
    return _REASON.get(reasons[0], "manual")


def day_facts(db: Session, kid, devices, now: datetime, runs=(), pre=None, slots=None) -> dict:
    fam = get_family(db)
    d = local_now(fam.timezone, now).date()
    windows = _allowed_windows(db, kid, fam, d, pre)
    if slots is None:
        slots = online_slots(db, devices, fam, d)
    done = sorted(
        (t for t in runs if svc.state(t) == "done" and t.completed_at),
        key=lambda t: t.completed_at,
    )
    return {
        "online_minutes": _online_minutes(devices, windows, slots),
        "allowed_minutes": sum(b - a for a, b in windows),
        "allowed": windows,
        "lock_reason": _lock_reason(db, devices, fam, now, pre),
        "completions": [
            {"title": svc.chore_of(t).title, "at": utc_z(t.completed_at)} for t in done
        ],
    }
