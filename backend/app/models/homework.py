"""Homework mode models."""

from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
)

from app.core.database import Base


class HomeworkSite(Base):
    """Allowed or blocked sites for homework mode."""

    __tablename__ = "homework_sites"
    __table_args__ = (
        UniqueConstraint("kid_id", "domain", "kind", name="uq_homework_site"),
        CheckConstraint("kind IN ('allow','block')", name="ck_homework_site_kind"),
        CheckConstraint("kind = 'allow' OR kid_id IS NULL", name="ck_homework_block_family"),
    )

    id = Column(Integer, primary_key=True)
    kid_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    domain = Column(String(253), nullable=False)
    kind = Column(String(10), nullable=False)  # 'allow' or 'block'
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class HomeworkRequest(Base):
    """Kid requests for homework mode."""

    __tablename__ = "homework_requests"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending','approved','denied')",
            name="ck_homework_request_status",
        ),
    )

    id = Column(Integer, primary_key=True)
    kid_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    status = Column(String(20), nullable=False, default="pending")
    minutes = Column(Integer, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    decided_at = Column(DateTime, nullable=True)
    decided_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)


class HomeworkActivity(Base):
    """Activity recorded during homework mode sessions."""

    __tablename__ = "homework_activity"
    __table_args__ = (
        UniqueConstraint("device_id", "session_start", "domain", name="uq_homework_activity"),
        CheckConstraint("via IN ('list','follow')", name="ck_homework_activity_via"),
    )

    id = Column(Integer, primary_key=True)
    device_id = Column(Integer, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False)
    session_start = Column(DateTime, nullable=False)
    domain = Column(String(253), nullable=False)
    via = Column(String(10), nullable=False)  # 'list' or 'follow'
    pulled_by = Column(String(253), nullable=True)
    first_seen = Column(DateTime, nullable=False)
    last_seen = Column(DateTime, nullable=False)
    lookups = Column(Integer, nullable=False, default=0)
    active_minutes = Column(Integer, nullable=False, default=0)
