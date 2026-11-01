"""Parent API: VLAN list, per-VLAN coverage and listen-only mode."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_parent
from app.lock.loop import trigger
from app.models.family import get_family
from app.models.lock import Vlan
from app.schemas.lock import utc_z

router = APIRouter(
    prefix="/api/v1/network", tags=["network"], dependencies=[Depends(require_parent)]
)


class NetworkPatch(BaseModel):
    listen_only: bool


class VlanPatch(BaseModel):
    name: str | None = Field(default=None, max_length=50)
    covered: bool | None = None


def _vlan_out(v: Vlan) -> dict:
    return {
        "vid": v.vid,
        "name": v.name,
        "subnet": v.subnet,
        "device_count": v.device_count,
        "covered": v.covered,
        "last_seen": utc_z(v.last_seen),
    }


def _network(db: Session) -> dict:
    rows = db.query(Vlan).order_by(Vlan.vid).all()
    return {
        "listen_only": get_family(db).listen_only,
        "trunk_detected": bool(rows),
        "vlans": [_vlan_out(v) for v in rows],
    }


@router.get("")
def get_network(db: Session = Depends(get_db)):
    out = _network(db)
    db.commit()  # get_family may create the row
    return out


@router.patch("")
def patch_network(body: NetworkPatch, db: Session = Depends(get_db)):
    get_family(db).listen_only = body.listen_only
    db.commit()
    trigger()
    return _network(db)


@router.patch("/vlans/{vid}")
def patch_vlan(vid: int, body: VlanPatch, db: Session = Depends(get_db)):
    v = db.get(Vlan, vid)
    if v is None:
        raise HTTPException(404, "VLAN not found.")
    if body.name is not None:
        v.name = body.name.strip() or None  # "" clears
    if body.covered is not None:
        v.covered = body.covered
    db.commit()
    trigger()
    return _vlan_out(v)
