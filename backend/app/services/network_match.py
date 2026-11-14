"""Resolve which tracked Network a device belongs to (by interface and/or CIDR)."""

import ipaddress

from sqlalchemy.orm import Session

from app.models.lock import Device
from app.models.network import Network


def _contains(subnet: str | None, ip: str | None) -> bool:
    try:
        return bool(subnet and ip and ipaddress.ip_address(ip) in ipaddress.ip_network(subnet))
    except ValueError:
        return False


def resolve_network_id(db: Session, ip: str | None, iface: str | None = None) -> int | None:
    """Network whose CIDR holds `ip` (preferring `iface`); else the only one on `iface`."""
    nets = db.query(Network).order_by(Network.id).all()
    hits = [n for n in nets if _contains(n.subnet, ip)]
    on_iface = [n for n in hits if n.iface == iface]
    if on_iface or hits:
        return (on_iface or hits)[0].id
    by_iface = [n for n in nets if iface and n.iface == iface]
    return by_iface[0].id if len(by_iface) == 1 else None


def backfill_network_ids(db: Session) -> int:
    """Set network_id on devices that have none. Caller commits."""
    n = 0
    for d in db.query(Device).filter(Device.network_id.is_(None), Device.ip.isnot(None)):
        if nid := resolve_network_id(db, d.ip):
            d.network_id = nid
            n += 1
    return n
