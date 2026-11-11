"""Minigame plays (earned, started, finished) and per-game progress."""

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    PrimaryKeyConstraint,
    String,
)

from app.core.database import Base


class GamePlay(Base):
    """One earned play. saved -> started -> done; revoked when its chore is undone."""

    __tablename__ = "game_plays"
    __table_args__ = (
        CheckConstraint(
            "status IN ('saved','started','done','revoked')", name="ck_game_play_status"
        ),
    )

    id = Column(Integer, primary_key=True)
    kid_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    run_id = Column(Integer, ForeignKey("chore_runs.id", ondelete="SET NULL"), nullable=True)
    earned_day = Column(Date, nullable=False)  # chore day; the daily cap belongs to it
    earned_at = Column(DateTime, nullable=False)
    status = Column(String(8), nullable=False, default="saved", server_default="saved")
    seen = Column(Boolean, nullable=False, default=False, server_default="0")
    token = Column(String(43), unique=True, nullable=True)
    game = Column(String(24), nullable=True)
    level = Column(Integer, nullable=True)
    slot = Column(Integer, nullable=True)
    started_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)
    score = Column(Integer, nullable=True)
    stars = Column(Integer, nullable=True)
    tickets = Column(Integer, nullable=True)
    points = Column(Integer, nullable=True)


class GameProgress(Base):
    """A kid's totals for one game (`quickfire`, `hungry-cat`, or `qf:<microgame>`)."""

    __tablename__ = "game_progress"
    __table_args__ = (PrimaryKeyConstraint("kid_id", "game"),)

    kid_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    game = Column(String(32), nullable=False)
    rounds = Column(Integer, nullable=False, default=0, server_default="0")
    best = Column(Integer, nullable=False, default=0, server_default="0")
    best_stars = Column(Integer, nullable=False, default=0, server_default="0")
    stars_total = Column(Integer, nullable=False, default=0, server_default="0")
    clears = Column(Integer, nullable=False, default=0, server_default="0")


class GamePowerUp(Base):
    """A wheel-bonus power-up a kid holds for one game until used."""

    __tablename__ = "game_power_ups"

    id = Column(Integer, primary_key=True)
    kid_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    game = Column(String(32), nullable=False)
    key = Column(String(16), nullable=False)
    won_at = Column(DateTime, nullable=False)
