"""Parent API: manage networks (interfaces) and their enforcement."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_parent
from app.models.network import Network

router = APIRouter(prefix="/api/v1/networks", tags=["networks"], dependencies=[Depends(require_parent)])


@router.get("", response_model=list[dict])
def list_networks(db: Session = Depends(get_db)):
    """List all networks (auto-detected LAN interfaces)."""
    networks = db.query(Network).order_by(Network.last_seen.desc()).all()
    return [
        {
            "id": n.id,
            "iface": n.iface,
            "subnet": n.subnet,
            "label": n.label(),
            "auto_label": n.auto_label,
            "custom_label": n.custom_label,
            "enforce": n.enforce,
            "last_seen": n.last_seen.isoformat(),
        }
        for n in networks
    ]


@router.patch("/{network_id}", response_model=dict)
def update_network(network_id: int, payload: dict, db: Session = Depends(get_db)):
    """Update network: rename (custom_label) or toggle enforce."""
    network = db.query(Network).filter(Network.id == network_id).first()
    if not network:
        raise HTTPException(status_code=404, detail="Network not found")

    if "custom_label" in payload:
        network.custom_label = payload["custom_label"]
    if "enforce" in payload:
        network.enforce = bool(payload["enforce"])

    db.commit()
    return {
        "id": network.id,
        "iface": network.iface,
        "label": network.label(),
        "enforce": network.enforce,
    }
