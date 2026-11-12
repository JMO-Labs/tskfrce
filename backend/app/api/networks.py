"""Parent API: manage networks (interfaces) and their enforcement."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, StrictBool, field_validator
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_parent
from app.models.network import Network

router = APIRouter(
    prefix="/api/v1/networks", tags=["networks"], dependencies=[Depends(require_parent)]
)


class NetworkUpdate(BaseModel):
    """PATCH body: both fields optional, unknown fields rejected."""

    model_config = ConfigDict(extra="forbid", strict=True)

    custom_label: str | None = None
    enforce: StrictBool | None = None

    @field_validator("custom_label")
    @classmethod
    def _trim_label(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        if not v:
            return None
        if len(v) > 40:
            raise ValueError("custom_label must be at most 40 characters")
        return v


def _serialize(n: Network) -> dict:
    return {
        "id": n.id,
        "iface": n.iface,
        "subnet": n.subnet,
        "label": n.label(),
        "auto_label": n.auto_label,
        "custom_label": n.custom_label,
        "enforce": n.enforce,
        "last_seen": n.last_seen.isoformat(),
    }


@router.get("", response_model=list[dict])
def list_networks(db: Session = Depends(get_db)):
    """List all networks (auto-detected LAN interfaces)."""
    networks = db.query(Network).order_by(Network.last_seen.desc()).all()
    return [_serialize(n) for n in networks]


@router.patch("/{network_id}", response_model=dict)
def update_network(network_id: int, payload: NetworkUpdate, db: Session = Depends(get_db)):
    """Update network: rename (custom_label) or toggle enforce."""
    network = db.query(Network).filter(Network.id == network_id).first()
    if not network:
        raise HTTPException(status_code=404, detail="Network not found")

    fields = payload.model_fields_set
    if "custom_label" in fields:
        network.custom_label = payload.custom_label
    if "enforce" in fields and payload.enforce is not None:
        network.enforce = payload.enforce

    db.commit()
    return _serialize(network)
