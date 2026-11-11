"""Internal endpoints used by the network blocker (shared-token auth)."""

import hmac
import ipaddress
import re
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.config import settings
from app.lock import activity
from app.lock.hints import apply_hint
from app.lock.identity import note_identity_change
from app.lock.loop import trigger
from app.lock.rules import block_reason
from app.lock.schedule import local_now
from app.lock.state import Prefetch, desired_blocked, device_facts
from app.models.device_activity import DeviceEvent
from app.models.family import get_family
from app.models.homework import HomeworkActivity
from app.models.lock import Device, Vlan
from app.models.network import Network
from app.schemas.homework import ActivityReport
from app.services import inbox

MAC_RE = re.compile(r"^([0-9a-f]{2}:){5}[0-9a-f]{2}$")

router = APIRouter(prefix="/api/v1/internal", tags=["internal"])


def _touch(db: Session) -> None:
    """Stamp blocker liveness; called from the endpoints its loops hit periodically."""
    get_family(db).blocker_last_seen = datetime.now(UTC).replace(tzinfo=None)
    db.commit()


def require_token(x_internal_token: str = Header(default="")) -> None:
    expected = (settings.INTERNAL_TOKEN or "").encode()
    if not expected or not hmac.compare_digest(x_internal_token.encode(), expected):
        raise HTTPException(403, "Missing or wrong internal token.")


class SeenReport(BaseModel):
    mac: str
    ip: str | None = None
    ipv6: list[str] = Field(default_factory=list, max_length=8)
    hostname: str | None = Field(default=None, max_length=255)
    vendor: str | None = Field(default=None, max_length=255)
    mdns_name: str | None = Field(default=None, max_length=255)
    model: str | None = Field(default=None, max_length=255)
    dhcp_fp: str | None = Field(default=None, max_length=255)
    vid: int | None = Field(default=None, ge=1, le=4094)  # null = untagged LAN

    @field_validator("mac")
    @classmethod
    def _mac(cls, v: str) -> str:
        v = v.strip().lower().replace("-", ":")
        if not MAC_RE.match(v):
            raise ValueError("MAC address must look like aa:bb:cc:dd:ee:ff.")
        return v

    @field_validator("ip")
    @classmethod
    def _ip(cls, v: str | None) -> str | None:
        if v is not None:
            ipaddress.IPv4Address(v)
        return v

    @field_validator("ipv6")
    @classmethod
    def _ipv6(cls, v: list[str]) -> list[str]:
        for a in v:
            ipaddress.IPv6Address(a)
        return v


class VlanItem(BaseModel):
    vid: int = Field(ge=1, le=4094)
    macs: int = Field(default=0, ge=0, le=100000)
    subnet: str | None = None

    @field_validator("subnet")
    @classmethod
    def _subnet(cls, v: str | None) -> str | None:
        if v is not None:
            v = str(ipaddress.ip_network(v, strict=False))
        return v


class VlansReport(BaseModel):
    vlans: list[VlanItem] = Field(max_length=4094)


class ResistingReport(BaseModel):
    resisting: list[str] = Field(max_length=1000)

    @field_validator("resisting")
    @classmethod
    def _macs(cls, v: list[str]) -> list[str]:
        out = [m.strip().lower().replace("-", ":") for m in v]
        if not all(MAC_RE.match(m) for m in out):
            raise ValueError("MAC address must look like aa:bb:cc:dd:ee:ff.")
        return out


class HitsReport(BaseModel):
    hits: dict[str, Annotated[int, Field(ge=1, le=10000)]] = Field(max_length=1000)

    @field_validator("hits")
    @classmethod
    def _macs(cls, v: dict[str, int]) -> dict[str, int]:
        out = {m.strip().lower().replace("-", ":"): n for m, n in v.items()}
        if not all(MAC_RE.match(m) for m in out):
            raise ValueError("MAC address must look like aa:bb:cc:dd:ee:ff.")
        return out


WORD = {"vpn": "a VPN", "private_dns": "private DNS", "proxy": "a proxy site", "tor": "Tor"}


class WorkaroundReport(BaseModel):
    found: dict[
        str, Annotated[list[Literal["vpn", "private_dns", "proxy", "tor"]], Field(max_length=4)]
    ] = Field(max_length=1000)

    @field_validator("found")
    @classmethod
    def _macs(cls, v: dict) -> dict:
        out = {m.strip().lower().replace("-", ":"): c for m, c in v.items()}
        if not all(MAC_RE.match(m) for m in out):
            raise ValueError("MAC address must look like aa:bb:cc:dd:ee:ff.")
        return out


class NetworkItem(BaseModel):
    iface: str = Field(max_length=15)
    subnet: str | None = None
    auto_label: str = Field(max_length=50)

    @field_validator("subnet")
    @classmethod
    def _subnet(cls, v: str | None) -> str | None:
        if v is not None:
            v = str(ipaddress.ip_network(v, strict=False))
        return v


class NetworksReport(BaseModel):
    networks: list[NetworkItem] = Field(max_length=100)


def _apply(dev: Device, body: SeenReport, now: datetime) -> None:
    dev.ip, dev.last_seen = body.ip, now
    dev.ipv6 = body.ipv6
    dev.hostname = body.hostname or dev.hostname
    dev.vendor = body.vendor or dev.vendor
    if "vid" in body.model_fields_set:  # absent key keeps the old value; explicit null = untagged
        dev.vlan_id = body.vid
    for k in ("mdns_name", "model", "dhcp_fp"):
        setattr(dev, k, getattr(body, k) or getattr(dev, k))


@router.post("/devices/seen", dependencies=[Depends(require_token)])
def devices_seen(body: SeenReport, db: Session = Depends(get_db)) -> dict:
    now = datetime.now(UTC).replace(tzinfo=None)
    dev = db.query(Device).filter(Device.mac == body.mac).first()
    new = dev is None
    hinted = False
    if new:
        dev = Device(
            mac=body.mac,
            name=(body.hostname or body.vendor or "Unknown device")[:100],
            status="unassigned",
            first_seen=now,
        )
        _apply(dev, body, now)
        db.add(dev)
        try:
            db.flush()
            # a hint sends its own notice; no bell while the wizard is running
            if not apply_hint(db, dev) and get_family(db).setup_step is None:
                inbox.notify_parents(
                    db,
                    "new_device",
                    f"New device: {dev.name}",
                    "Say whose it is so it follows their rules.",
                    device_id=dev.id,
                )
            db.commit()
        except IntegrityError:  # concurrent first report for the same MAC
            db.rollback()
            dev = db.query(Device).filter(Device.mac == body.mac).one()
            new = False
    if new:
        trigger()
    else:
        old_ip = dev.ip
        before = (dev.mdns_name, dev.model, dev.dhcp_fp)
        _apply(dev, body, now)
        if old_ip is not None and body.ip is not None and old_ip != body.ip:
            activity.log(db, dev.id, "address_change", now, detail=f"{old_ip} → {body.ip}")
        note_identity_change(db, dev, before[1], now)
        changed = before != (dev.mdns_name, dev.model, dev.dhcp_fp)
        hinted = changed and dev.status == "unassigned" and apply_hint(db, dev)
    if new and dev.hostname:
        _note_new_address(db, dev, now)
    activity.sample(db, dev, now)
    db.commit()
    if hinted:
        trigger()
    return {"id": dev.id}


def _note_new_address(db: Session, new: Device, now: datetime) -> None:
    """A fresh device sharing a hostname with one locked moments ago is probably the same hardware."""
    other = (
        db.query(Device)
        .filter(
            Device.id != new.id,
            func.lower(Device.hostname) == new.hostname.lower(),
            Device.blocked_since >= now - activity.SLOT,
        )
        .first()
    )
    if other:
        mins = round((now - other.blocked_since).total_seconds() / 60)
        activity.log(db, other.id, "new_address", now, other_device_id=new.id, minutes=mins)
        # security ping: ignores quiet hours like the resist detector's bypass
        inbox.notify_parents(
            db,
            "device_bypass",
            f"{other.name} got around the lock",
            f"A new address showed up {mins} min after {other.name} was locked. "
            "It may be the same device with a new Wi-Fi address. Tap to check.",
            device_id=other.id,
        )


@router.get("/state", dependencies=[Depends(require_token)])
def state(db: Session = Depends(get_db)) -> dict:
    from app.lock.homework import state_map
    from app.lock.state import Prefetch, device_facts
    from app.models.family import get_family

    _touch(db)
    fam = get_family(db)
    covered = [v for (v,) in db.query(Vlan.vid).filter(Vlan.covered.is_(True)).order_by(Vlan.vid)]
    blocked = [] if fam.listen_only else desired_blocked(db, datetime.now(UTC))

    # Build homework map
    homework = {}
    if not fam.listen_only:
        devices = db.query(Device).all()
        pre = Prefetch(db, devices)
        rows = [(d, device_facts(db, d, fam, datetime.now(UTC), pre)) for d in devices]
        homework = state_map(db, rows, set(blocked))

    # Build network enforce map: {iface+subnet: enforce_bool}
    network_enforce = {}
    for net in db.query(Network):
        key = f"{net.iface}:{net.subnet}" if net.subnet else net.iface
        network_enforce[key] = net.enforce

    return {
        "blocked": blocked,
        "homework": homework,
        "listen_only": fam.listen_only,
        "covered_vlans": covered,
        "network_enforce": network_enforce,  # NEW: enforce state per network
    }


@router.post("/vlans", dependencies=[Depends(require_token)])
def vlans_report(body: VlansReport, db: Session = Depends(get_db)) -> dict:
    now = datetime.now(UTC).replace(tzinfo=None)
    items = {i.vid: i for i in body.vlans}  # a repeated vid: last one wins
    rows = {v.vid: v for v in db.query(Vlan).filter(Vlan.vid.in_(items))}
    for vid, i in items.items():
        row = rows.get(vid)
        if row is None:
            row = Vlan(vid=vid, first_seen=now)
            db.add(row)
        row.device_count, row.last_seen = i.macs, now
        row.subnet = i.subnet or row.subnet
    db.commit()
    return {"count": len(items)}


@router.post("/devices/resisting", dependencies=[Depends(require_token)])
def devices_resisting(body: ResistingReport, db: Session = Depends(get_db)) -> dict:
    _touch(db)
    now = datetime.now(UTC).replace(tzinfo=None)
    listed = set(body.resisting)
    flagged = cleared = 0
    try:
        for dev in db.query(Device).all():
            if dev.mac in listed:
                if dev.resisting_since is not None:
                    continue
                dev.resisting_since = now
                flagged += 1
                activity.log(db, dev.id, "bypass", now)
                # security ping: notify.ping applies quiet hours (quiet_security)
                inbox.notify_parents(
                    db,
                    "device_bypass",
                    f"{dev.name} got around the lock",
                    f"{dev.name} is still reaching the internet while it "
                    "should be paused. Someone may have changed its network "
                    "settings. Tap for what to check.",
                    device_id=dev.id,
                )
            elif dev.resisting_since is not None:
                dev.resisting_since = None
                cleared += 1
                open_ev = (
                    db.query(DeviceEvent)
                    .filter(
                        DeviceEvent.device_id == dev.id,
                        DeviceEvent.kind == "bypass",
                        DeviceEvent.last_at.is_(None),
                    )
                    .order_by(DeviceEvent.at.desc(), DeviceEvent.id.desc())
                    .first()
                )
                if open_ev:
                    open_ev.last_at = now
        db.commit()
    except Exception:
        db.rollback()
        raise
    return {"flagged": flagged, "cleared": cleared}


@router.post("/devices/hits", dependencies=[Depends(require_token)])
def devices_hits(body: HitsReport, db: Session = Depends(get_db)) -> dict:
    """Portal hits from blocked devices become 'tried while locked' alerts."""
    _touch(db)
    now = datetime.now(UTC).replace(tzinfo=None)
    devs = (
        db.query(Device).filter(Device.mac.in_(body.hits), Device.blocked_since.isnot(None)).all()
    )
    fam, logged = get_family(db), 0
    local, pre = local_now(fam.timezone, now), Prefetch(db, devs)
    for d in devs:
        reason = block_reason(device_facts(db, d, fam, now, pre), local)
        if reason is None:  # open now; the next tick clears blocked_since
            continue
        kind = "outside_hours" if reason == "schedule" else "locked_try"
        activity.log(db, d.id, kind, now, merge_minutes=30, count=body.hits[d.mac], reason=reason)
        logged += 1
    db.commit()
    return {"logged": logged}


@router.post("/devices/workarounds", dependencies=[Depends(require_token)])
def devices_workarounds(body: WorkaroundReport, db: Session = Depends(get_db)) -> dict:
    """A paused device looked up a VPN, private-DNS, proxy or Tor name: tell parents once per pause."""
    _touch(db)
    now = datetime.now(UTC).replace(tzinfo=None)
    devs = (
        db.query(Device).filter(Device.mac.in_(body.found), Device.blocked_since.isnot(None)).all()
    )
    fam, logged = get_family(db), 0
    local, pre = local_now(fam.timezone, now), Prefetch(db, devs)
    for d in devs:
        if block_reason(device_facts(db, d, fam, now, pre), local) is None:
            continue  # open now; the next tick clears blocked_since
        for cat in dict.fromkeys(body.found[d.mac]):
            seen = (
                db.query(DeviceEvent.id)
                .filter(
                    DeviceEvent.device_id == d.id,
                    DeviceEvent.kind == "workaround_try",
                    DeviceEvent.reason == cat,
                    DeviceEvent.at >= d.blocked_since,
                )
                .first()
            )
            if seen:
                continue
            activity.log(db, d.id, "workaround_try", now, reason=cat)
            inbox.notify_parents(
                db,
                "workaround_try",
                f"{d.name} tried {WORD[cat]}",
                "It didn't work \u2014 the pause is still on.",
                device_id=d.id,
            )
            logged += 1
    db.commit()
    return {"logged": logged}


HW_ACTIVITY_MAX_ROWS = 5000  # per device per session; matches the blocker's name cap


@router.post("/homework/activity", dependencies=[Depends(require_token)])
def homework_activity(body: ActivityReport, db: Session = Depends(get_db)) -> dict:
    """Upsert per-name homework totals; the blocker sends running totals, so they replace."""
    macs = {i.mac for i in body.items}
    ids = dict(db.query(Device.mac, Device.id).filter(Device.mac.in_(macs))) if macs else {}
    stored = 0
    for i in body.items:
        if i.mac not in ids:
            continue
        key = {"device_id": ids[i.mac], "session_start": i.session_start, "domain": i.domain}
        row = db.query(HomeworkActivity).filter_by(**key).first()
        if row is None:
            sess = db.query(HomeworkActivity).filter_by(
                device_id=ids[i.mac], session_start=i.session_start
            )
            if sess.count() >= HW_ACTIVITY_MAX_ROWS:
                continue  # session full: keep known rows, refuse new names
            row = HomeworkActivity(**key, first_seen=i.first_seen, last_seen=i.last_seen)
            db.add(row)
        row.via, row.pulled_by = i.via, i.pulled_by
        row.last_seen = max(row.last_seen, i.last_seen)
        row.lookups, row.active_minutes = i.lookups, i.active_minutes
        db.flush()
        stored += 1
    db.commit()
    return {"ok": True, "stored": stored}


@router.post("/networks", dependencies=[Depends(require_token)])
def report_networks(body: NetworksReport, db: Session = Depends(get_db)) -> dict:
    """Upsert detected networks from blocker (interfaces, subnets, labels)."""
    now = datetime.now(UTC).replace(tzinfo=None)
    upserted = 0
    for net_item in body.networks:
        # Find or create network by (iface, subnet)
        net = db.query(Network).filter(
            Network.iface == net_item.iface,
            Network.subnet == net_item.subnet,
        ).first()
        if net is None:
            net = Network(
                iface=net_item.iface,
                subnet=net_item.subnet,
                auto_label=net_item.auto_label,
                enforce=True,  # default: enforce on all new networks
            )
            db.add(net)
        else:
            # Update auto_label if it changed
            if net.auto_label != net_item.auto_label:
                net.auto_label = net_item.auto_label
        net.last_seen = now
        db.flush()
        upserted += 1
    db.commit()
    _touch(db)
    return {"ok": True, "upserted": upserted}
