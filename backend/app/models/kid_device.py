"""Kid phone enrollment: single-use tokens and device sessions. Only sha256 hashes are stored."""

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, UniqueConstraint

from app.core.database import Base


class KidEnrollToken(Base):
    __tablename__ = "kid_enroll_tokens"
    __table_args__ = (UniqueConstraint("token_hash", name="uq_kid_enroll_tokens_token_hash"),)

    id = Column(Integer, primary_key=True)
    kid_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE", name="fk_kid_enroll_tokens_kid"),
        nullable=False,
        index=True,
    )
    token_hash = Column(String(64), nullable=False)
    created_by_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL", name="fk_kid_enroll_tokens_created_by"),
        nullable=True,
    )
    created_at = Column(DateTime, nullable=False)  # naive UTC
    expires_at = Column(DateTime, nullable=False)
    used_at = Column(DateTime, nullable=True)


class KidDevice(Base):
    __tablename__ = "kid_devices"
    # AUTOINCREMENT: a removed phone's id is never handed to a new phone (tokens carry the id)
    __table_args__ = (
        UniqueConstraint("secret_hash", name="uq_kid_devices_secret_hash"),
        {"sqlite_autoincrement": True},
    )

    id = Column(Integer, primary_key=True)
    kid_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE", name="fk_kid_devices_kid"),
        nullable=False,
        index=True,
    )
    secret_hash = Column(String(64), nullable=False)
    label = Column(String(40), nullable=False)
    created_at = Column(DateTime, nullable=False)  # naive UTC
    last_seen_at = Column(DateTime, nullable=False)  # sliding 180-day expiry
