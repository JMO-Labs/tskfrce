"""Request bodies for the parent lock APIs."""

import re
from datetime import UTC, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints, field_validator, model_validator

HHMM = r"([01]\d|2[0-3]):[0-5]\d"


def utc_z(dt: datetime | None) -> str | None:
    """Naive-UTC (or aware) datetime -> ISO string ending in Z."""
    if dt is None:
        return None
    dt = dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt.astimezone(UTC)
    return dt.isoformat().replace("+00:00", "Z")


def _hhmm(v: str | None) -> str | None:
    if v is not None and not re.fullmatch(HHMM, v):
        raise ValueError("Use 24-hour HH:MM, like 06:00.")
    return v


def _pin(v: str | None) -> str | None:
    if v is not None and not re.fullmatch(r"\d{4}", v):
        raise ValueError("PIN must be exactly 4 digits.")
    return v


class OverrideIn(BaseModel):
    action: Literal["lock", "unlock", "homework"]
    minutes: int | None = Field(default=None, ge=1, le=1440)


class DevicePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    status: Literal["unassigned", "assigned", "guest"] | None = None
    owner_ids: list[int] | None = None
    group_ids: list[int] | None = None
    exempt: bool | None = None


class GroupIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    device_ids: list[int] = []
    icon: str | None = Field(default=None, min_length=1, max_length=40)
    chore_lock: bool | None = None
    screen_price: int | None = Field(None, ge=1, le=1000)


def _birth_pair(m):
    if (m.birth_month is None) != (m.birth_year is None):
        raise ValueError("Give both birth month and year, or neither.")
    return m


class KidCreate(BaseModel):
    full_name: str = Field(min_length=1, max_length=100)
    avatar: str | None = Field(default=None, max_length=255)
    pin: str | None = None
    age_group: Literal["little", "kid", "teen"] | None = None
    birth_month: int | None = Field(default=None, ge=1, le=12)
    birth_year: int | None = Field(default=None, ge=1990, le=2100)

    _pin = field_validator("pin")(_pin)
    _birth = model_validator(mode="after")(_birth_pair)


class KidPatch(BaseModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=100)
    avatar: str | None = Field(default=None, max_length=255)
    pin: str | None = None
    clear_pin: bool = False
    age_group: Literal["little", "kid", "teen"] | None = None
    birth_month: int | None = Field(default=None, ge=1, le=12)
    birth_year: int | None = Field(default=None, ge=1990, le=2100)
    celebrate: Literal["full", "small", "off"] | None = None
    trust_mode: bool | None = None
    trust_level: int | None = Field(default=None, ge=0, le=2)
    chores_lock: bool | None = None
    games_on: bool | None = None

    _pin = field_validator("pin")(_pin)
    _birth = model_validator(mode="after")(_birth_pair)


class FamilyPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    timezone: str | None = None
    reset_time: str | None = None
    new_devices_blocked: bool | None = None
    points_unlock_early: bool | None = None
    early_bonus_cap: int | None = Field(default=None, ge=0, le=50)
    screen_time_price: int | None = Field(default=None, ge=1, le=1000)
    listen_only: bool | None = None
    chores_lock: bool | None = None
    gifs_enabled: bool | None = None
    gif_rating: Literal["g", "pg"] | None = None
    ntfy_upstream_relay: bool | None = None
    quick_replies: (
        list[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]]
        | None
    ) = Field(default=None, max_length=8)
    giphy_api_key: str | None = Field(default=None, max_length=100)  # "" clears
    hh_default_mult_x10: Literal[15, 20, 30] | None = None
    hh_default_minutes: Literal[30, 60, 90] | None = None
    hh_weekly_surprise: bool | None = None
    hh_auto_boost: bool | None = None
    streak_freeze: bool | None = None
    bedtime_auto: bool | None = None
    bedtime_auto_at: str | None = None
    recap_weekly: bool | None = None
    games_on: bool | None = None
    games_earn: Literal["every", "daily", "random", "custom"] | None = None
    games_cap_pct: int | None = Field(default=None, ge=0, le=50)
    games_board: bool | None = None
    penalties_enabled: bool | None = None
    penalty_sizes: dict | None = None
    makeup_chores: (
        list[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]]
        | None
    ) = Field(default=None, min_length=1, max_length=12)
    accent: (
        Literal[
            "neon", "sun", "tangerine", "bubblegum", "lilac", "sky", "aqua", "mint", "peach", "ice"
        ]
        | None
    ) = None

    @field_validator("quick_replies")
    @classmethod
    def _dedupe_replies(cls, v: list[str] | None) -> list[str] | None:
        return None if v is None else list(dict.fromkeys(v))  # keep order, drop repeats

    @field_validator("penalty_sizes")
    @classmethod
    def _sizes(cls, v):
        from app.schemas.penalty import check_sizes

        return check_sizes(v)

    _rt = field_validator("reset_time", "bedtime_auto_at")(_hhmm)
