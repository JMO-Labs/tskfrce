"""Savings goals: a kid's own or the family's, funded from the points ledger."""

from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
)

from app.core.database import Base

KINDS = ("custom", "screen", "jail")
STATUSES = ("suggested", "active", "full", "fulfilled")
CONTRIB_KINDS = ("save", "auto", "return", "chip_in", "take")


def _in(col: str, vals) -> str:
    return f"{col} IN (" + ",".join(f"'{v}'" for v in vals) + ")"


class Goal(Base):
    __tablename__ = "goals"
    __table_args__ = (
        CheckConstraint(_in("kind", KINDS), name="ck_goal_kind"),
        CheckConstraint(_in("status", STATUSES), name="ck_goal_status"),
    )

    id = Column(Integer, primary_key=True)
    name = Column(String(60), nullable=False)
    emoji = Column(String(16), nullable=True)
    kind = Column(String(6), nullable=False, default="custom", server_default="custom")
    kid_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    target = Column(Integer, nullable=True)  # NULL only while suggested
    minutes = Column(Integer, nullable=True)  # screen goals only
    status = Column(String(9), nullable=False, default="active", server_default="active")
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    owner_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    reached_at = Column(DateTime, nullable=True)
    fulfilled_at = Column(DateTime, nullable=True)
    fulfilled_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    played_at = Column(DateTime, nullable=True)  # jail goals: when the card was played
    penalty_id = Column(Integer, ForeignKey("penalties.id", ondelete="SET NULL"), nullable=True)


class GoalContribution(Base):
    """Signed points in or out of a goal; a goal's saved amount is SUM(amount)."""

    __tablename__ = "goal_contributions"
    __table_args__ = (CheckConstraint(_in("kind", CONTRIB_KINDS), name="ck_goal_contrib_kind"),)

    id = Column(Integer, primary_key=True)
    goal_id = Column(
        Integer, ForeignKey("goals.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kid_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    amount = Column(Integer, nullable=False)
    kind = Column(String(7), nullable=False)
    note = Column(String(120), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class GoalAuto(Base):
    """The goal a kid's auto-share goes to."""

    __tablename__ = "goal_auto"

    kid_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    goal_id = Column(Integer, ForeignKey("goals.id", ondelete="CASCADE"), nullable=False)


class GoalParty(Base):
    """Per-kid 'goal came true' party; seen_at is set once played."""

    __tablename__ = "goal_parties"

    goal_id = Column(Integer, ForeignKey("goals.id", ondelete="CASCADE"), primary_key=True)
    kid_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    seen_at = Column(DateTime, nullable=True)
