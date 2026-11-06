"""Screen-time purchase rules: daily max, per-kid limits, allowed hours."""

from datetime import UTC, datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.lock.reset import current_chore_day
from app.lock.rules import in_allowed, in_off
from app.lock.schedule import local_now
from app.lock.state import device_facts
from app.models.family import FamilySettings, get_family
from app.models.lock import DeviceGroup
from app.models.reward import Redemption
from app.models.screen_time import ScreenTimeLimit
from app.models.user import User
from app.services import economy


def day_start_utc(fam: FamilySettings, now_utc: datetime) -> datetime:
    """Naive UTC start of the current chore day: its most recent reset, never in the future
    (a fresh install between midnight and the reset time is still on the previous day)."""
    day = current_chore_day(fam, _aware(now_utc))
    start = economy.deadline_utc(fam, day, fam.reset_time)
    now = _aware(now_utc).astimezone(UTC).replace(tzinfo=None)
    return (
        start
        if start <= now
        else economy.deadline_utc(fam, day - timedelta(days=1), fam.reset_time)
    )


def _aware(now: datetime) -> datetime:
    return now.replace(tzinfo=UTC) if now.tzinfo is None else now


def bought_today(db: Session, fam: FamilySettings, kid_ids: list[int], now_utc: datetime):
    """Minutes bought (pending + approved) since today's reset, per kid."""
    rows = (
        db.query(Redemption.kid_id, func.coalesce(func.sum(Redemption.minutes), 0))
        .filter(
            Redemption.kid_id.in_(kid_ids),
            Redemption.kind == "screen_time",
            Redemption.status.in_(("pending", "approved")),
            Redemption.created_at >= day_start_utc(fam, now_utc),
        )
        .group_by(Redemption.kid_id)
        .all()
    )
    out = {k: 0 for k in kid_ids}
    out.update({k: int(m) for k, m in rows})
    return out


def limit_for(db: Session, fam: FamilySettings, kid_id: int) -> tuple[int | None, int | None]:
    """(effective max minutes per day, min points) for a kid."""
    row = db.get(ScreenTimeLimit, kid_id)
    caps = [m for m in (fam.screen_max_minutes, row.max_minutes if row else None) if m]
    return (min(caps) if caps else None), (row.min_points if row else None)


def in_allowed_hours(db: Session, kid: User, now_utc: datetime) -> bool:
    if not kid.devices:
        return True
    fam = get_family(db)
    now_local = local_now(fam.timezone, now_utc)
    return any(in_allowed(device_facts(db, d, fam, now_utc), now_local) for d in kid.devices)


def all_in_off_window(db: Session, kid: User, now_utc: datetime) -> bool:
    """Every device of the kid is inside an internet-off window (bonus can't open those)."""
    if not kid.devices:
        return False
    fam = get_family(db)
    now_local = local_now(fam.timezone, now_utc)
    return all(in_off(device_facts(db, d, fam, now_utc), now_local) for d in kid.devices)


def check(db: Session, fam: FamilySettings, kid: User, minutes: int, now_utc: datetime) -> None:
    cap, min_points = limit_for(db, fam, kid.id)
    if min_points and economy.balance(db, kid.id) - economy.pending_cost(db, kid.id) < min_points:
        raise HTTPException(409, f"You can buy screen time once you have {min_points} points.")
    if cap is not None:
        left = cap - bought_today(db, fam, [kid.id], now_utc)[kid.id]
        if left <= 0:
            raise HTTPException(409, "You've had all your screen time for today.")
        if minutes > left:
            raise HTTPException(
                409, f"That's over today's limit. You can buy {left} more minutes today."
            )
    if fam.screen_only_allowed_hours and not in_allowed_hours(db, kid, now_utc):
        raise HTTPException(409, "Screen time only works during your allowed hours.")
    if not fam.screen_only_allowed_hours and all_in_off_window(db, kid, now_utc):
        raise HTTPException(409, "Screen time can't turn the internet on during off hours.")


def options(db: Session, fam: FamilySettings, kid: User) -> list[dict]:
    """What the kid can buy time for: "All my devices", then "Other devices" (no group), then
    chore-locked groups by id. Exempt and free-only devices are never priced. "All" costs the
    max of what it covers; if every option costs the same, only "All" is left.
    Group pricing is opt-in: when it is off, "All" at the family price is the only option."""
    fam_price = fam.screen_time_price
    if not fam.group_pricing:
        return [_opt("all", None, "All my devices", "devices", fam_price)]
    devs = [d for d in kid.devices if not d.exempt]
    groups = {g.id: g for d in devs for g in d.groups if g.chore_lock}
    prices = {gid: g.screen_price or fam_price for gid, g in groups.items()}
    # offer a group only if some device in it opens at its price (not a dearer shared one)
    prices = {
        gid: p
        for gid, p in prices.items()
        if any(device_price(fam, d) <= p for d in devs if groups[gid] in d.groups)
    }
    other = any(not d.groups for d in devs)
    top = max([fam_price] * other + list(prices.values()), default=fam_price)
    out = [_opt("all", None, "All my devices", "devices", top)]
    if other and top > fam_price:
        out.append(_opt("other", None, "Other devices", "devices", fam_price))
    out += [
        _opt("group", gid, groups[gid].name, groups[gid].icon, p)
        for gid, p in sorted(prices.items())
    ]
    return out if any(o["price"] != top for o in out) else out[:1]


def _opt(scope: str, group_id: int | None, name: str, icon: str | None, price: int) -> dict:
    return {"group_id": group_id, "scope": scope, "name": name, "icon": icon, "price": price}


def price_for(db: Session, fam: FamilySettings, kid: User, scope: str, group_id: int | None) -> int:
    for o in options(db, fam, kid):
        if o["scope"] == scope and (scope != "group" or o["group_id"] == group_id):
            return o["price"]
    raise HTTPException(400, "Pick one of your options.")


def group_devices(kid: User, group_id: int | None) -> list:
    if group_id is None:
        return list(kid.devices)
    return [d for d in kid.devices if any(g.id == group_id for g in d.groups)]


def device_price(fam: FamilySettings, dev) -> int:
    """What it costs to buy time for this device: the dearest of its chore-locked groups."""
    prices = [g.screen_price or fam.screen_time_price for g in dev.groups if g.chore_lock]
    return max(prices, default=fam.screen_time_price)


def unlock_targets(db: Session, fam: FamilySettings, kid: User, red: Redemption) -> list:
    """Devices an approved screen-time request opens. 'all': every device. 'other': devices in
    no chore-locked group. 'group': the group's devices the paid rate (or the group's current
    price, if raised since) covers, so a dearer shared device stays locked.
    409 before any charge when nothing is left to open."""
    if red.screen_scope == "other":
        out = [d for d in kid.devices if not any(g.chore_lock for g in d.groups)]
    elif red.screen_scope == "group":
        g = db.get(DeviceGroup, red.device_group_id) if red.device_group_id else None
        out = []
        if g is not None:
            cap = max(red.cost // (red.minutes // 15), g.screen_price or fam.screen_time_price)
            out = [d for d in group_devices(kid, g.id) if device_price(fam, d) <= cap]
    else:
        return list(kid.devices)
    if not out:
        raise HTTPException(
            409,
            f"None of those devices belong to {kid.full_name} anymore. "
            "Deny the request to give the points back.",
        )
    return out
