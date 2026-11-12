"""Dismiss/mute state for Today suggestions (one family per box)."""

from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Integer, String, UniqueConstraint

from app.core.database import Base


class SuggestionState(Base):
    """A dismissed suggestion (key + fingerprint) or a muted rule (muted=True)."""

    __tablename__ = "suggestion_state"
    __table_args__ = (UniqueConstraint("family_id", "key", name="uq_suggestion_state_key"),)

    id = Column(Integer, primary_key=True)
    family_id = Column(Integer, nullable=False, default=1, server_default="1", index=True)
    key = Column(String(80), nullable=False)
    fingerprint = Column(String(80), nullable=True)
    muted = Column(Boolean, nullable=False, default=False, server_default="0")
    at = Column(DateTime, nullable=False, default=datetime.utcnow)
