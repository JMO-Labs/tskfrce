"""Parent API: devices and device groups."""

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy import delete
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_db, require_parent
from app.lock import activity, blocker_client, hours
from app.lock.device_names import display_device_name, guess_maker_from_signals
from app.lock.loop import trigger
from app.lock.overrides import clear_override, set_homework, set_override
from app.lock.rules import block_reason, open_reason
from app.lock.schedule import local_now
from app.lock.state import Prefetch, device_facts, device_penalty
from app.models.device_activity import DeviceEvent, DevicePresence
from app.models.family import FamilySettings, get_family
from app.models.hours import HourRuleTarget
from app.models.lock import (
    Device,
    DeviceGroup,
    DeviceHintRejection,
    Override,
    device_group_members,
)
from app.models.user import User, UserRole
from app.schemas.lock import DeviceBulk, DevicePatch, GroupIn, OverrideIn, utc_z
from app.services import economy

router = APIRouter(prefix="/api/v1", tags=["devices"], dependencies=[Depends(require_parent)])

# Box reports resistance every 15s and polls state every 30s; 3 missed beats = offline.
BLOCKER_STALE = timedelta(seconds=90)

# Setup rescan rate limit: once per 10 seconds per box
RESCAN_INTERVAL = 10


SEEN_NOW = timedelta(minutes=5)  # the box rescans every ~20 s; allow for sleepy phones


def _setup_devices(devs: list[Device]) -> list[dict]:
    """Format devices for onboarding setup: name/maker guessing, no admin-level fields."""
    out = []
    for d in devs:
        display_name, name_source = display_device_name(
            d.mdns_name, d.hostname, d.dhcp_fp, d.vendor
        )
        maker_guess = guess_maker_from_signals(d.dhcp_fp, d.mdns_name)
        item = {
            "id": d.id,
            "display_name": display_name,
            "name_source": name_source,
            "mac": d.mac,
            "ip": d.ip,
            "vendor": d.vendor,
            "maker_guess": maker_guess,
            "random_mac": d.random_mac,
            "status": d.status,
            "owner_ids": sorted(o.id for o in d.owners),
        }
        # ponytail: network field is optional until PR #136 supplies it in backend
        if d.vlan_id is not None:
            item["network"] = d.vlan_id
        out.append(item)
    return out


def device_out(
    db: Session,
    d: Device,
    fam: FamilySettings,
    now: datetime,
    pre: Prefetch | None = None,
    addresses: bool = False,
    stats: dict | None = None,
) -> dict:
    """Device JSON; `now` is aware UTC. Pass `pre` when rendering many devices.

    `addresses` adds ip, ipv6, hostname, first_seen, address_changes, blocked_since (the
    Network tab); Today skips them. `stats` is activity.device_stats(); missing = 0 alerts.
    """
    if pre:
        ov = next((o for o in pre.overrides[d.id] if o.source == "manual"), None)
    else:
        ov = (
            db.query(Override)
            .filter(Override.device_id == d.id, Override.source == "manual")
            .order_by(Override.created_at.desc(), Override.id.desc())
            .first()
        )
    if ov and ov.expires_at and ov.expires_at <= now.replace(tzinfo=None):
        ov = None
    f = device_facts(db, d, fam, now, pre)
    now_local = local_now(fam.timezone, now)
    reason = block_reason(f, now_local)
    pen = None
    if reason == "penalty":
        naive = now.replace(tzinfo=None)
        q = pre.overrides[d.id] if pre else db.query(Override).filter(Override.device_id == d.id)
        po = next(
            (
                o
                for o in sorted(q, key=lambda o: (o.created_at, o.id), reverse=True)
                if o.source == "penalty" and (o.expires_at is None or o.expires_at > naive)
            ),
            None,
        )
        pen = {"id": po.penalty_id, "ends_at": utc_z(po.expires_at)} if po else None
        wk = device_penalty(db, d, now, pre)
        if wk and (po is None or wk.id > (po.penalty_id or 0)):
            pen = {"id": wk.id, "ends_at": utc_z(wk.ends_at)}
    online = reason is None
    alerts, changes = (stats or {}).get(d.id, (0, 0))
    lock_at = None
    if f.status == "assigned" and not f.exempt:
        lock_at = (
            None if f.override == "unlock" else hours.locks_at(f.allowed_sets, f.off, now_local)
        )
    # two or more kids share this device and someone can sign in without a PIN
    active_kids = [k for k in d.owners if k.role == UserRole.KID and k.is_active]
    needs_pins = len(active_kids) >= 2 and any(not k.pin_hash for k in active_kids)
    out = {
        "id": d.id,
        "name": d.name,
        "mac": d.mac,
        "vendor": d.vendor,
        "status": d.status,
        "owner_ids": sorted(o.id for o in d.owners),
        "group_ids": sorted(g.id for g in d.groups),
        "online": online,
        "override": {"action": ov.action, "expires_at": utc_z(ov.expires_at)} if ov else None,
        "last_seen": utc_z(d.last_seen),
        "seen_now": d.last_seen is not None and now.replace(tzinfo=None) - d.last_seen <= SEEN_NOW,
        "resisting": d.resisting_since is not None,
        "needs_pins": needs_pins,
        "hint_of_id": d.hint_of_id,
        "hint_reason": d.hint_reason,
        "mdns_name": d.mdns_name,
        "model": d.model,
        "random_mac": d.random_mac,
        "vlan_id": d.vlan_id,
        "network_id": d.network_id,
        "exempt": bool(d.exempt),
        "reason": reason or open_reason(f, now_local),
        "chores_done": sum(o.approved for o in f.owners),
        "chores_total": sum(o.total for o in f.owners),
        "locks_at": utc_z(lock_at),
        "penalty": pen,
        "alerts": alerts,
    }
    if addresses:
        out |= {
            "first_seen": utc_z(d.first_seen),
            "ip": d.ip,
            "ipv6": d.ipv6,
            "hostname": d.hostname,
            "address_changes": changes,
            "blocked_since": utc_z(d.blocked_since),
        }
    return out


def _device(db: Session, device_id: int) -> Device:
    d = db.get(Device, device_id)
    if d is None:
        raise HTTPException(404, "That device doesn't exist. Refresh the list and try again.")
    return d


def _devices(db: Session, ids: list[int]) -> list[Device]:
    rows = db.query(Device).filter(Device.id.in_(ids)).all() if ids else []
    if len(rows) != len(set(ids)):
        raise HTTPException(400, "One of the devices doesn't exist. Refresh and try again.")
    return rows


def _commit(db: Session, msg: str, code: int = 409) -> None:
    """Two taps at once can both pass a check and then collide on a unique key: answer, don't 500."""
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(code, msg) from None


@router.get("/blocker")
def blocker_status(db: Session = Depends(get_db)) -> dict:
    seen = get_family(db).blocker_last_seen  # naive UTC
    online = seen is not None and datetime.now(UTC).replace(tzinfo=None) - seen < BLOCKER_STALE
    return {"online": online, "last_seen": utc_z(seen)}


@router.get("/devices")
def list_devices(db: Session = Depends(get_db)):
    fam, now = get_family(db), datetime.now(UTC)
    devs = (
        db.query(Device)
        .options(
            selectinload(Device.owners), selectinload(Device.groups), selectinload(Device.ipv6_rows)
        )
        .filter(Device.replaced.is_(False))
        .order_by(Device.id)
        .all()
    )
    devs = [d for d in devs if not d.is_gateway and not d.is_box]  # never the router or our box
    if fam.setup_step is not None:
        return _setup_devices(devs)

    pre = Prefetch(db, devs)
    stats = activity.device_stats(db, now)
    return [device_out(db, d, fam, now, pre, addresses=True, stats=stats) for d in devs]


@router.post("/devices/rescan")
def rescan_devices(db: Session = Depends(get_db)):
    """Trigger immediate device discovery sweep. Rate-limited to once per 10 seconds."""
    fam = get_family(db)
    now = datetime.now(UTC).replace(tzinfo=None)

    # Check rate limit
    if fam.last_rescan_at and (now - fam.last_rescan_at) < timedelta(seconds=RESCAN_INTERVAL):
        seconds_ago = int((now - fam.last_rescan_at).total_seconds())
        wait = RESCAN_INTERVAL - seconds_ago
        raise HTTPException(429, f"Rescan available in {wait} seconds")

    # Update timestamp and commit before calling blocker
    fam.last_rescan_at = now
    db.commit()

    if not blocker_client.rescan():
        return JSONResponse(
            status_code=502,
            content={"ok": False, "detail": "The box couldn't start a scan. Try again in a moment."},
        )

    return {"ok": True, "last_scanned": utc_z(now)}


@router.post("/devices/bulk")
def bulk_devices(body: DeviceBulk, db: Session = Depends(get_db)):
    """Set status (and owners, for assigned) on many devices in one transaction."""
    devs = _devices(db, body.ids)
    kids: list[User] = []
    if body.status == "assigned":
        kids = db.query(User).filter(User.id.in_(body.owner_ids), User.role == UserRole.KID).all()
        if not kids or len(kids) != len(set(body.owner_ids)):
            raise HTTPException(400, "Pick one or more existing kids to assign these devices to.")
    for d in devs:
        d.status = body.status
        d.owners = list(kids)
    _commit(db, "Those devices just changed somewhere else. Refresh and try again.")
    trigger()
    fam, now = get_family(db), datetime.now(UTC)
    pre = Prefetch(db, devs)
    return [device_out(db, d, fam, now, pre, addresses=True) for d in devs]


@router.patch("/devices/{device_id}")
def patch_device(device_id: int, body: DevicePatch, db: Session = Depends(get_db)):
    d = _device(db, device_id)
    if body.name is not None:
        d.name = body.name
    if body.status is not None:
        d.status = body.status
    if body.exempt is not None:
        d.exempt = body.exempt
    if body.owner_ids is not None:
        kids = db.query(User).filter(User.id.in_(body.owner_ids), User.role == UserRole.KID).all()
        if len(kids) != len(set(body.owner_ids)):
            raise HTTPException(400, "Owners must be existing kids. Pick from the kid list.")
        d.owners = kids
        if body.status != "guest" and not (d.status == "guest" and not kids):
            d.status = "assigned" if kids else "unassigned"
    if body.group_ids is not None:
        groups = db.query(DeviceGroup).filter(DeviceGroup.id.in_(body.group_ids)).all()
        if len(groups) != len(set(body.group_ids)):
            raise HTTPException(400, "One of the groups doesn't exist. Refresh and try again.")
        d.groups = groups
    _commit(db, "That device just changed somewhere else. Refresh and try again.")
    trigger()
    now = datetime.now(UTC)
    stats = activity.device_stats(db, now, [d.id])
    return device_out(db, d, get_family(db), now, addresses=True, stats=stats)


@router.post("/devices/{device_id}/hint/undo")
def undo_hint(device_id: int, db: Session = Depends(get_db)):
    d = _device(db, device_id)
    if d.hint_of_id is None:
        raise HTTPException(404, "There's no suggestion to undo on this device.")
    db.merge(DeviceHintRejection(device_id=d.id, candidate_id=d.hint_of_id))
    d.owners, d.groups = [], []
    db.query(Override).filter(Override.device_id == d.id).delete()  # incl. the copied lock
    d.status = "unassigned"
    if d.hint_reason == "relink":
        db.query(Device).filter(Device.id == d.hint_of_id).update({"replaced": False})
    d.hint_of_id = d.hint_reason = None
    db.commit()
    trigger()
    return device_out(db, d, get_family(db), datetime.now(UTC))


@router.post("/devices/{device_id}/override")
def device_override(
    device_id: int,
    body: OverrideIn,
    db: Session = Depends(get_db),
    parent: User = Depends(require_parent),
):
    d = _device(db, device_id)
    if body.action == "homework":
        return homework(db, [d], body.minutes, parent, f"{d.name} is already online.", fan=False)
    set_override(db, [device_id], body.action, body.minutes, parent.id)
    db.commit()
    trigger()
    return {"ok": True}


def homework(
    db: Session, devices: list[Device], minutes: int | None, parent: User, none: str, fan=True
) -> dict:
    """Homework mode on the paused ones among `devices`; 409 `none` when none are paused."""
    applied = set_homework(db, devices, minutes, parent.id, datetime.now(UTC))
    if not applied:
        raise HTTPException(409, none)
    db.commit()
    trigger()
    out = {"ok": True, "expires_at": utc_z(min(o.expires_at for o in applied))}
    return {**out, "devices": len(applied)} if fan else out


@router.delete("/devices/{device_id}/override")
def device_clear_override(device_id: int, db: Session = Depends(get_db)):
    _device(db, device_id)
    clear_override(db, [device_id])
    db.commit()
    trigger()
    return {"ok": True}


@router.post("/devices/{device_id}/test-block")
def test_block(device_id: int, db: Session = Depends(get_db)):
    d = _device(db, device_id)
    result = blocker_client.test_block(d.mac)
    if result is None:
        raise HTTPException(503, "The home box didn't answer. Is it plugged in?")
    return result


def purge_device(db: Session, d: Device) -> None:
    """Remove a device and everything that points at it. Caller commits."""
    d.owners = []
    db.query(Override).filter(Override.device_id == d.id).delete()
    db.execute(delete(device_group_members).where(device_group_members.c.device_id == d.id))
    db.query(DeviceEvent).filter(DeviceEvent.device_id == d.id).delete()
    db.query(DeviceEvent).filter(DeviceEvent.other_device_id == d.id).update(
        {"other_device_id": None}
    )
    db.query(DevicePresence).filter(DevicePresence.device_id == d.id).delete()
    db.expire(d)
    db.delete(d)


@router.delete("/devices/{device_id}")
def delete_device(device_id: int, db: Session = Depends(get_db)):
    purge_device(db, _device(db, device_id))
    db.commit()
    trigger()
    return {"ok": True}


# ---- groups ----


def _group_out(g: DeviceGroup) -> dict:
    return {
        "id": g.id,
        "name": g.name,
        "device_ids": sorted(d.id for d in g.devices),
        "icon": g.icon,
        "chore_lock": g.chore_lock,
        "screen_price": g.screen_price,
    }


def _group(db: Session, group_id: int) -> DeviceGroup:
    g = db.get(DeviceGroup, group_id)
    if g is None:
        raise HTTPException(404, "That group doesn't exist. Refresh the list and try again.")
    return g


def _name_free(db: Session, name: str, own_id: int | None = None) -> None:
    q = db.query(DeviceGroup).filter(DeviceGroup.name == name)
    if own_id:
        q = q.filter(DeviceGroup.id != own_id)
    if q.first():
        raise HTTPException(400, "A group with that name already exists. Pick another name.")


@router.get("/groups")
def list_groups(db: Session = Depends(get_db)):
    return [_group_out(g) for g in db.query(DeviceGroup).order_by(DeviceGroup.id)]


@router.post("/groups")
def create_group(body: GroupIn, db: Session = Depends(get_db)):
    _name_free(db, body.name)
    g = DeviceGroup(name=body.name, icon=body.icon or "devices")
    if body.chore_lock is not None:
        g.chore_lock = body.chore_lock
    g.screen_price = body.screen_price
    g.devices = _devices(db, body.device_ids)
    db.add(g)
    _commit(db, "A group with that name already exists. Pick another name.", 400)
    trigger()
    return _group_out(g)


@router.patch("/groups/{group_id}")
def patch_group(group_id: int, body: GroupIn, db: Session = Depends(get_db)):
    g = _group(db, group_id)
    _name_free(db, body.name, g.id)
    g.name = body.name
    if body.icon is not None:
        g.icon = body.icon
    if body.chore_lock is not None:
        g.chore_lock = body.chore_lock
    if "screen_price" in body.model_fields_set:
        g.screen_price = body.screen_price
    g.devices = _devices(db, body.device_ids)
    _commit(db, "A group with that name already exists. Pick another name.", 400)
    trigger()
    return _group_out(g)


@router.delete("/groups/{group_id}")
def delete_group(group_id: int, db: Session = Depends(get_db)):
    g = _group(db, group_id)
    with economy.SPEND_LOCK:  # held to the commit so no one approves meanwhile
        economy.deny_group_requests(db, g.id)  # owner ruling: waiting requests are denied
        db.query(HourRuleTarget).filter_by(group_id=g.id).delete()
        g.devices = []
        db.flush()
        db.delete(g)
        db.commit()
    trigger()
    return {"ok": True}


@router.post("/groups/{group_id}/override")
def group_override(
    group_id: int,
    body: OverrideIn,
    db: Session = Depends(get_db),
    parent: User = Depends(require_parent),
):
    g = _group(db, group_id)
    if body.action == "homework":
        return homework(db, g.devices, body.minutes, parent, _none_paused(g.name))
    set_override(db, [d.id for d in g.devices], body.action, body.minutes, parent.id)
    db.commit()
    trigger()
    return {"ok": True, "devices": len(g.devices)}


def _none_paused(name: str) -> str:
    return f"None of {name}'s devices are paused."


@router.delete("/groups/{group_id}/override")
def group_clear_override(group_id: int, db: Session = Depends(get_db)):
    g = _group(db, group_id)
    clear_override(db, [d.id for d in g.devices])
    db.commit()
    trigger()
    return {"ok": True}
