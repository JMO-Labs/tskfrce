"""Happy Hour: a time window where submitted chores earn a points multiplier."""

from datetime import datetime

from sqlalchemy import JSON, CheckConstraint, Column, DateTime, ForeignKey, Integer, String

from app.core.database import Base


class HappyHour(Base):
    __tablename__ = "happy_hours"
    __table_args__ = (
        CheckConstraint("mult_x10 IN (15, 20, 30)", name="ck_hh_mult"),
        CheckConstraint("source IN ('parent','schedule','auto')", name="ck_hh_source"),
    )

    id = Column(Integer, primary_key=True)
    starts_at = Column(DateTime, nullable=False, index=True)  # naive UTC
    ends_at = Column(DateTime, nullable=False, index=True)  # naive UTC; stop moves it earlier
    mult_x10 = Column(Integer, nullable=False)  # 15 / 20 / 30 = x1.5 / x2 / x3
    source = Column(String(10), nullable=False)
    kid_ids = Column(JSON, nullable=True)  # NULL = all kids
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
