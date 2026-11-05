"""Kid phone enrollment: single-use tokens and device sessions. Only sha256 hashes are stored."""

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String

from app.core.database import Base


class KidEnrollToken(Base):
    __tablename__ = "kid_enroll_tokens"

    id = Column(Integer, primary_key=True)
    kid_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash = Column(String(64), unique=True, nullable=False)
    created_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, nullable=False)  # naive UTC
    expires_at = Column(DateTime, nullable=False)
    used_at = Column(DateTime, nullable=True)


class KidDevice(Base):
    __tablename__ = "kid_devices"

    id = Column(Integer, primary_key=True)
    kid_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    secret_hash = Column(String(64), unique=True, nullable=False)
    label = Column(String(40), nullable=False)
    created_at = Column(DateTime, nullable=False)  # naive UTC
    last_seen_at = Column(DateTime, nullable=False)  # sliding 180-day expiry
