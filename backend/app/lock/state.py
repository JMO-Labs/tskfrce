"""Turn rules + DB rows into the list of MACs that must be offline."""

from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session, selectinload

from app.lock import activity, hours
from app.lock.reset import current_chore_day, reset_due
from app.lock.rules import DeviceFacts, OwnerChores, is_online
from app.lock.schedule import local_now
from app.models.family import FamilySettings, get_family
from app.models.homework import HomeworkActivity
from app.models.lock import Device, Override
from app.models.penalty import Penalty
from app.services import chores

HOMEWORK_ACTIVITY_DAYS = 7  # activity names stay on the box this long


def _naive_utc(now: datetime) -> datetime:
    if now.tzinfo is not None:
        now = now.astimezone(UTC).replace(tzinfo=None)
    return now


def whole_kid_penalties(db: Session, now: datetime, kid_ids=None) -> dict[int, Penalty]:
    """kid id -> newest live "all of the kid's devices" block penalty (one query)."""
    q = db.query(Penalty).filter(
        Penalty.kind == "block",
        Penalty.all_devices.is_(True),
        Penalty.status == "active",
        Penalty.ends_at > _naive_utc(now),
    )
    if kid_ids is not None:
        q = q.filter(Penalty.kid_id.in_(kid_ids))
    return {p.kid_id: p for p in q.order_by(Penalty.id)}  # newest id wins


def device_penalty(
    db: Session, device: Device, now: datetime, pre: "Prefetch | None" = None
) -> Penalty | None:
    """Whole-kid penalty covering this device (none for exempt devices)."""
    if device.exempt:
        return None
    wk = pre.whole_kid if pre else whole_kid_penalties(db, now, [o.id for o in device.owners])
    hits = [wk[o.id] for o in device.owners if o.id in wk]
    return max(hits, key=lambda p: p.id) if hits else None


def _aware_utc(now: datetime) -> datetime:
    return now.replace(tzinfo=UTC) if now.tzinfo is None else now


class Prefetch:
    """Overrides and hour rules for many devices in a few queries (avoids N+1 in list endpoints).

    `counts` maps kid id -> (approved, total) for the chore day; pass it when the caller
    already holds today's runs, otherwise each owner is counted on demand.
    """

    def __init__(self, db: Session, devices: list[Device], counts: dict | None = None):
        ids = {d.id for d in devices}
        self.overrides: dict[int, list[Override]] = {i: [] for i in ids}
        for o in (
            db.query(Override)
            .filter(Override.device_id.in_(ids))
            .order_by(Override.created_at.desc(), Override.id.desc())
        ):
            self.overrides[o.device_id].append(o)
        self.rules = hours.load(db)
        self.whole_kid = whole_kid_penalties(db, datetime.now(UTC))
        self.counts = counts or {}


def device_facts(
    db: Session, device: Device, fam: FamilySettings, now_utc: datetime, pre: Prefetch | None = None
) -> DeviceFacts:
    now = _naive_utc(now_utc)
    day = current_chore_day(fam, _aware_utc(now_utc))
    overrides = (
        pre.overrides.get(device.id, [])
        if pre
        else db.query(Override)
        .filter(Override.device_id == device.id)
        .order_by(Override.created_at.desc(), Override.id.desc())
        .all()
    )
    live = [o for o in overrides if o.expires_at is None or o.expires_at > now]
    manual = [o for o in live if o.source == "manual"]

    # Homework rides on top of whatever pauses the device: a lock under it still counts.
    homework = next((o for o in manual if o.action == "homework"), None)
    homework_until = homework.expires_at if homework else None
    override_for_block = next((o.action for o in manual if o.action != "homework"), None)

    r = hours.resolve(
        pre.rules if pre else hours.load(db),
        {o.id for o in device.owners},
        {g.id for g in device.groups},
        local_now(fam.timezone, _aware_utc(now_utc)).date(),
    )
    return DeviceFacts(
        status=device.status,
        owners=tuple(
            OwnerChores(t, a)
            for a, t in (
                (0, 0)
                if not o.chores_lock
                else _counts(db, o.id, day, pre)  # lock off: chores never block
                for o in device.owners
            )
        ),
        allowed_sets=r.allowed_sets,
        free=r.free,
        off=r.off,
        exempt=device.exempt,
        chores_apply=fam.chores_lock and all(g.chore_lock for g in device.groups),
        override=override_for_block,
        bonus_active=any(o.source == "bonus" for o in live),
        penalty=any(o.source == "penalty" for o in live)
        or device_penalty(db, device, now_utc, pre) is not None,
        new_devices_blocked=fam.new_devices_blocked,
        points_unlock_early=fam.points_unlock_early,
        bonus_any_hours=not fam.screen_only_allowed_hours,
        homework_until=homework_until,
    )


def _counts(db: Session, kid_id: int, day, pre: Prefetch | None) -> tuple[int, int]:
    """A kid's (approved, total), counted once per Prefetch (one chore day per call)."""
    if pre is None:
        return chores.counts(db, kid_id, day)
    if kid_id not in pre.counts:
        pre.counts[kid_id] = chores.counts(db, kid_id, day)
    return pre.counts[kid_id]


def desired_blocked(db: Session, now_utc: datetime) -> list[str]:
    fam = get_family(db)
    now_local = local_now(fam.timezone, _aware_utc(now_utc))
    devs = db.query(Device).options(selectinload(Device.owners), selectinload(Device.groups)).all()
    pre = Prefetch(db, devs)
    return sorted(
        d.mac for d in devs if not is_online(device_facts(db, d, fam, now_utc, pre), now_local)
    )


def tick(db: Session, now_utc: datetime) -> tuple[list[str], dict]:
    from app.lock.homework import clamp, state_map

    fam = get_family(db)
    now_local = local_now(fam.timezone, _aware_utc(now_utc))
    if reset_due(fam, now_local):
        from app.services import screen_bank  # screen_time imports this module

        screen_bank.settle(db, fam, now_utc)
        chores.run_reset(db, now_local.date())
    now = _naive_utc(now_utc)
    from app.services import penalty_earnback  # services import this module

    penalty_earnback.expire(db, now)
    db.query(Override).filter(Override.expires_at.isnot(None), Override.expires_at <= now).delete()
    db.commit()
    devices = db.query(Device).all()
    pre = Prefetch(db, devices)
    rows = [(d, device_facts(db, d, fam, now_utc, pre)) for d in devices]
    rows = [(d, clamp(f, pre.overrides[d.id], now_local)) for d, f in rows]
    blocked = sorted(d.mac for d, f in rows if not is_online(f, now_local))
    homework = state_map(db, rows, set(blocked))
    activity.record_transitions(db, rows, now, now_local)
    activity.prune(db, now)
    cutoff = now - timedelta(days=HOMEWORK_ACTIVITY_DAYS)
    db.query(HomeworkActivity).filter(HomeworkActivity.last_seen < cutoff).delete()
    db.commit()
    return blocked, homework
