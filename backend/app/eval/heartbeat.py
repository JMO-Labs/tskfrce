"""Daily anonymous heartbeat: counts only, no names."""

from collections import defaultdict
from datetime import date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.eval import store
from app.eval.events import emit
from app.models.chores import ChoreRun
from app.models.lock import Device
from app.models.user import User, UserRole

KEYS = (
    "parent_opened",
    "kids_opened",
    "chores_assigned",
    "chores_done",
    "chores_approved",
    "chores_skipped",
    "locks_by_hours",
    "locks_by_chores",
    "manual_unlocks",
    "manual_locks",
    "chores_stale_3d",
    "devices_total",
    "kids_total",
)


def stale_3d(db: Session, day: date) -> int:
    rows = db.execute(
        select(
            ChoreRun.assignment_id,
            ChoreRun.kid_id,
            ChoreRun.day,
            ChoreRun.status,
            ChoreRun.submitted_at,
        ).where(ChoreRun.day >= day - timedelta(days=2), ChoreRun.day <= day)
    ).all()
    groups = defaultdict(list)
    for aid, kid, d, status, sub in rows:
        groups[(aid, kid)].append((d, status, sub))
    return sum(
        len({d for d, _, _ in g}) == 3
        and all(st not in ("done", "skipped") and sub is None for _, st, sub in g)
        for g in groups.values()
    )


def build(db: Session, day: date) -> dict[str, int]:
    iso = day.isoformat()
    out = dict.fromkeys(KEYS, 0)
    out.update({k: v for k, v in store.counters(iso).items() if k in out})
    out["parent_opened"], out["kids_opened"] = store.seen_counts(iso)
    out["chores_stale_3d"] = stale_3d(db, day)
    out["devices_total"] = (
        db.scalar(select(func.count()).select_from(Device).where(Device.status == "assigned")) or 0
    )
    out["kids_total"] = (
        db.scalar(
            select(func.count())
            .select_from(User)
            .where(User.role == UserRole.KID, User.is_active.is_(True))
        )
        or 0
    )
    return out


def maybe_send(db: Session, now_utc: datetime) -> bool:
    today = store.local_day(now_utc)
    if store.kv_get("first_day") is None:
        store.kv_set("first_day", today)
    yday = store.local_day(now_utc, 1)
    if yday < store.kv_get("first_day") or store.kv_get("heartbeat_day") == yday:
        return False
    emit("heartbeat", build(db, date.fromisoformat(yday)) | {"day": yday})
    store.kv_set("heartbeat_day", yday)
    return True
