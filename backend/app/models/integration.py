"""Integrations: installs, per-kid/chore grants, audit log and event outbox."""

from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from app.core.database import Base


class IntegrationInstall(Base):
    __tablename__ = "integration_installs"
    __table_args__ = (
        CheckConstraint("source IN ('catalog','local')", name="ck_integration_source"),
        CheckConstraint(
            "status IN ('active','paused','revoked','removed')", name="ck_integration_status"
        ),
    )

    id = Column(Integer, primary_key=True)
    public_id = Column(String(32), nullable=False, unique=True)
    source = Column(String(8), nullable=False)
    integration_id = Column(String(40), nullable=True)
    name = Column(String(40), nullable=False)
    icon = Column(String(40), nullable=False)
    manifest = Column(Text, nullable=True)  # signed manifest envelope JSON
    settings = Column(Text, nullable=True)  # JSON, non-secret fields only
    permissions = Column(Text, nullable=False)  # JSON list
    secret = Column(Text, nullable=True)  # sealed
    key_hash = Column(String(64), nullable=True, unique=True)
    key_prefix = Column(String(16), nullable=True)
    trusted = Column(Boolean, nullable=False, default=False, server_default="0")
    status = Column(String(10), nullable=False, default="active")
    paused_reason = Column(String(200), nullable=True)
    failures = Column(Integer, nullable=False, default=0, server_default="0")
    next_poll_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    removed_at = Column(DateTime, nullable=True)

    kids = relationship("IntegrationKid", cascade="all, delete-orphan", passive_deletes=True)
    chores = relationship("IntegrationChore", cascade="all, delete-orphan", passive_deletes=True)


class IntegrationKid(Base):
    __tablename__ = "integration_kids"

    install_id = Column(
        Integer, ForeignKey("integration_installs.id", ondelete="CASCADE"), primary_key=True
    )
    kid_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    kid_widgets = Column(Boolean, nullable=False, default=False, server_default="0")


class IntegrationChore(Base):
    __tablename__ = "integration_chores"

    install_id = Column(
        Integer, ForeignKey("integration_installs.id", ondelete="CASCADE"), primary_key=True
    )
    chore_id = Column(Integer, ForeignKey("chores.id", ondelete="CASCADE"), primary_key=True)


class IntegrationAction(Base):
    """Audit log of every action an integration attempted."""

    __tablename__ = "integration_actions"
    __table_args__ = (
        CheckConstraint(
            "result IN ('applied','pending','rejected')", name="ck_integration_action_result"
        ),
        UniqueConstraint("install_id", "idempotency_key", name="uq_integration_action_key"),
        Index("ix_integration_actions_install_created", "install_id", "created_at"),
    )

    id = Column(Integer, primary_key=True)
    install_id = Column(
        Integer, ForeignKey("integration_installs.id", ondelete="CASCADE"), nullable=False
    )
    kind = Column(String(24), nullable=False)
    idempotency_key = Column(String(80), nullable=False)
    result = Column(String(8), nullable=False)
    reason = Column(String(200), nullable=True)
    kid_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    chore_id = Column(Integer, ForeignKey("chores.id", ondelete="SET NULL"), nullable=True)
    run_id = Column(Integer, ForeignKey("chore_runs.id", ondelete="SET NULL"), nullable=True)
    redemption_id = Column(
        Integer, ForeignKey("redemptions.id", ondelete="SET NULL"), nullable=True
    )
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class IntegrationEvent(Base):
    """Outbox of events waiting to be delivered to an integration."""

    __tablename__ = "integration_events"

    id = Column(Integer, primary_key=True)
    install_id = Column(
        Integer, ForeignKey("integration_installs.id", ondelete="CASCADE"), nullable=False
    )
    kind = Column(String(24), nullable=False)
    payload = Column(Text, nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    attempts = Column(Integer, nullable=False, default=0, server_default="0")
