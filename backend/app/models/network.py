"""Network model: tracked LAN interfaces and subnets."""

from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Integer, String, UniqueConstraint

from app.core.database import Base


class Network(Base):
    """A detected LAN interface + subnet. Upserted from blocker reports."""

    __tablename__ = "networks"
    __table_args__ = (UniqueConstraint("iface", "subnet", name="uq_network_iface_subnet"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    iface = Column(String(15), nullable=False)  # interface name (eno2, wlo1, etc.)
    subnet = Column(String(43), nullable=True)  # CIDR (192.168.1.0/24)
    auto_label = Column(String(50), nullable=False)  # "Wired", "WiFi-SSID", "VLAN 30"
    custom_label = Column(String(100), nullable=True)  # parent's custom name
    enforce = Column(Boolean, nullable=False, default=True, server_default="1")
    first_seen = Column(DateTime, nullable=False, default=datetime.utcnow)
    last_seen = Column(DateTime, nullable=False, default=datetime.utcnow)

    def label(self) -> str:
        """Return custom label if set, otherwise auto label."""
        return self.custom_label or self.auto_label
