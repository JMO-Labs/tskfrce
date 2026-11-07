"""Trust mode history: level moves and catches, one row per affected kid."""

from datetime import datetime

from sqlalchemy import CheckConstraint, Column, DateTime, ForeignKey, Integer, String

from app.core.database import Base


class TrustEvent(Base):
    __tablename__ = "trust_events"
    __table_args__ = (CheckConstraint("kind IN ('up','down','catch')", name="ck_trust_kind"),)

    id = Column(Integer, primary_key=True)
    kid_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    at = Column(DateTime, nullable=False, default=datetime.utcnow)
    kind = Column(String(5), nullable=False)
    run_id = Column(Integer, ForeignKey("chore_runs.id", ondelete="SET NULL"), nullable=True)
    by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
