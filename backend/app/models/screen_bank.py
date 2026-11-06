"""Per-kid bank of unused daily screen-time room."""

from sqlalchemy import CheckConstraint, Column, Date, ForeignKey, Integer

from app.core.database import Base


class ScreenBank(Base):
    __tablename__ = "screen_banks"
    __table_args__ = (CheckConstraint("minutes >= 0", name="ck_screen_bank_minutes"),)

    kid_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    minutes = Column(Integer, nullable=False, default=0, server_default="0")
    day = Column(Date, nullable=True)  # last chore day settled
