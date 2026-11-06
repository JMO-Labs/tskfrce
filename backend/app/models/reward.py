"""Rewards catalog and point-spend requests."""

from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
)

from app.core.database import Base


class Reward(Base):
    __tablename__ = "rewards"
    __table_args__ = (
        UniqueConstraint(
            "integration_install_id", "integration_ref", name="uq_reward_integration_ref"
        ),
    )

    id = Column(Integer, primary_key=True)
    name = Column(String(100), nullable=False)
    price = Column(Integer, nullable=False)
    icon = Column(String(40), nullable=True)
    active = Column(Boolean, nullable=False, default=True)
    visible = Column(Boolean, nullable=False, default=True, server_default="1")
    needs_approval = Column(Boolean, nullable=False, default=True, server_default="1")
    created_at = Column(DateTime, default=datetime.utcnow)
    integration_install_id = Column(
        Integer,
        ForeignKey(
            "integration_installs.id", ondelete="SET NULL", name="fk_reward_integration_install"
        ),
        nullable=True,
    )
    integration_ref = Column(String(64), nullable=True)


class Redemption(Base):
    __tablename__ = "redemptions"
    __table_args__ = (
        CheckConstraint("kind IN ('screen_time','reward')", name="ck_redemption_kind"),
        CheckConstraint("status IN ('pending','approved','denied')", name="ck_redemption_status"),
        CheckConstraint("(kind = 'reward') = (reward_id IS NOT NULL)", name="ck_redemption_reward"),
        CheckConstraint(
            "(kind = 'screen_time') = (minutes IS NOT NULL)", name="ck_redemption_minutes"
        ),
        CheckConstraint(
            "screen_scope IN ('all','other','group')", name="ck_redemption_screen_scope"
        ),
    )

    id = Column(Integer, primary_key=True)
    kid_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    kind = Column(String(12), nullable=False)  # screen_time | reward
    reward_id = Column(Integer, ForeignKey("rewards.id"), nullable=True)
    minutes = Column(Integer, nullable=True)
    cost = Column(Integer, nullable=False)
    status = Column(String(10), nullable=False, default="pending")  # pending|approved|denied
    created_at = Column(DateTime, default=datetime.utcnow)
    decided_at = Column(DateTime, nullable=True)
    decided_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    seen_by_kid = Column(Boolean, nullable=False, default=False)
    auto = Column(Boolean, nullable=False, default=False, server_default="0")
    note = Column(String(200), nullable=True)
    # the device a screen-time request is about (kid's pick); gone device -> NULL
    device_id = Column(Integer, ForeignKey("devices.id", ondelete="SET NULL"), nullable=True)
    # the device group a screen-time request is for; deleted group -> NULL
    device_group_id = Column(
        Integer, ForeignKey("device_groups.id", ondelete="SET NULL"), nullable=True
    )
    # screen time only: what was bought (all devices | ungrouped "other" | one group)
    screen_scope = Column(String(8), nullable=True)
