"""Family settings (single row, id=1)."""

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Session

from app.core.database import Base


class FamilySettings(Base):
    __tablename__ = "family_settings"
    __table_args__ = (
        CheckConstraint("gif_rating IN ('g','pg')", name="ck_family_gif_rating"),
        CheckConstraint(
            "accent IN ('neon','sun','tangerine','bubblegum','lilac','sky','aqua','mint','peach','ice')",
            name="ck_family_accent",
        ),
    )

    id = Column(Integer, primary_key=True)
    name = Column(String(100), nullable=False, default="My Family")
    timezone = Column(String(50), nullable=False, default="UTC")
    reset_time = Column(String(5), nullable=False, default="06:00")
    new_devices_blocked = Column(Boolean, nullable=False, default=False)  # learning mode: fail open
    points_unlock_early = Column(Boolean, nullable=False, default=False)
    early_bonus_cap = Column(Integer, nullable=False, default=5, server_default="5")
    screen_time_price = Column(Integer, nullable=False, default=20, server_default="20")
    gifs_enabled = Column(Boolean, nullable=False, default=False, server_default="0")
    giphy_api_key = Column(String(100), nullable=True)  # write-only through the API
    gif_rating = Column(String(2), nullable=False, default="g", server_default="g")
    listen_only = Column(Boolean, nullable=False, default=False, server_default="0")
    accent = Column(String(12), nullable=False, default="neon", server_default="neon")
    chores_lock = Column(Boolean, nullable=False, default=True, server_default="1")
    last_reset_date = Column(Date, nullable=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    ntfy_upstream_relay = Column(Boolean, nullable=False, default=False, server_default="0")
    screen_max_minutes = Column(Integer, nullable=True)  # NULL = no daily max
    screen_auto_approve = Column(Boolean, nullable=False, default=False, server_default="0")
    screen_only_allowed_hours = Column(Boolean, nullable=False, default=True, server_default="1")
    group_pricing = Column(Boolean, nullable=False, default=False, server_default="0")  # opt-in
    quick_replies = Column(Text, nullable=True)  # JSON list; NULL = defaults
    blocker_last_seen = Column(DateTime, nullable=True)  # naive UTC; home box heartbeat
    quiet_start = Column(String(5), nullable=True)
    quiet_end = Column(String(5), nullable=True)
    quiet_security = Column(Boolean, nullable=False, default=True, server_default="1")
    app_address = Column(String(200), nullable=True)
    summary_date = Column(Date, nullable=True)
    notify_scan_at = Column(DateTime, nullable=True)  # naive UTC
    blocker_alerted = Column(Boolean, nullable=False, default=False, server_default="0")
    preset_style = Column(String(8), nullable=True)  # family-wide style last applied
    preset_base = Column(Text, nullable=True)  # JSON of values the presets last wrote
    setup_step = Column(Integer, nullable=True)  # wizard step to resume; NULL = done/not started
    screen_rollover = Column(Boolean, nullable=False, default=True, server_default="1")
    screen_bank_cap = Column(Integer, nullable=True)  # NULL = one day's max
    hh_default_mult_x10 = Column(Integer, nullable=False, default=20, server_default="20")
    hh_default_minutes = Column(Integer, nullable=False, default=60, server_default="60")
    hh_weekly_surprise = Column(Boolean, nullable=False, default=False, server_default="0")
    hh_auto_boost = Column(Boolean, nullable=False, default=True, server_default="1")
    hh_auto_date = Column(Date, nullable=True)  # local day the auto boost job last ran
    hh_surprise_date = Column(Date, nullable=True)  # local day this week's surprise was planned
    hh_surprise_at = Column(DateTime, nullable=True)  # naive UTC start of the planned surprise
    streak_freeze = Column(Boolean, nullable=False, default=True, server_default="1")
    bedtime_auto = Column(Boolean, nullable=False, default=False, server_default="0")
    bedtime_auto_at = Column(String(5), nullable=False, default="21:00", server_default="21:00")
    bedtime_date = Column(Date, nullable=True)  # local day bedtime auto-approve last ran
    recap_weekly = Column(Boolean, nullable=False, default=True, server_default="1")
    recap_date = Column(Date, nullable=True)  # local day the weekly recap last went out
    waiting_reset_days = Column(Integer, nullable=False, default=0, server_default="0")


def get_family(db: Session) -> FamilySettings:
    """Return the family row, creating it if missing."""
    fam = db.get(FamilySettings, 1)
    if fam is None:
        fam = FamilySettings(id=1, name="My Family")
        db.add(fam)
        db.flush()

    db.info["family"] = fam  # strong ref: the identity map is weak, so repeat calls re-query
    return fam


def owner_set(db: Session) -> bool:
    """True once the first parent owns the box (the one owner check for setup and claim)."""
    fam = db.get(FamilySettings, 1)
    return fam is not None and fam.owner_id is not None
