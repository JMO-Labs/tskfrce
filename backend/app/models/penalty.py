"""Penalties: points taken, screen time docked, or a device/app blocked."""

from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, Column, DateTime, ForeignKey, Integer, String, Text

from app.core.database import Base


class Penalty(Base):
    __tablename__ = "penalties"
    __table_args__ = (
        CheckConstraint("kind IN ('points','screen','block')", name="ck_penalty_kind"),
        CheckConstraint("earn_back IN ('none','half','all')", name="ck_penalty_earn_back"),
        CheckConstraint(
            "status IN ('active','ended','forgiven','cancelled')", name="ck_penalty_status"
        ),
    )

    id = Column(Integer, primary_key=True)
    kid_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    group_id = Column(String(32), nullable=True)
    kind = Column(String(6), nullable=False)
    amount = Column(Integer, nullable=False)
    amount_taken = Column(Integer, nullable=False, default=0, server_default="0")
    amount_returned = Column(Integer, nullable=False, default=0, server_default="0")
    back_total = Column(Integer, nullable=False, default=0, server_default="0")
    makeup_count = Column(Integer, nullable=False, default=0, server_default="0")
    earn_back = Column(String(4), nullable=False, default="none", server_default="none")
    device_ids = Column(Text, nullable=True)  # JSON list
    label = Column(String(100), nullable=True)  # block target, e.g. "Nintendo" / "devices"
    reason = Column(String(200), nullable=True)
    chore_run_id = Column(Integer, ForeignKey("chore_runs.id", ondelete="SET NULL"), nullable=True)
    notification_id = Column(
        Integer, ForeignKey("notifications.id", ondelete="SET NULL"), nullable=True
    )
    given_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    ends_at = Column(DateTime, nullable=True)
    ended_at = Column(DateTime, nullable=True)
    status = Column(String(9), nullable=False, default="active", server_default="active")
    seen_by_kid = Column(Boolean, nullable=False, default=False, server_default="0")
