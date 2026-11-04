"""Homework mode request bodies."""

import re
from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class DecideIn(BaseModel):
    minutes: int = Field(default=60, ge=15, le=240)


class SiteIn(BaseModel):
    domain: str = Field(max_length=2048)
    kind: Literal["allow", "block"]
    kid_id: int | None = None


MAC_RE = re.compile(r"^([0-9a-f]{2}:){5}[0-9a-f]{2}$")


def _naive_utc(v: datetime) -> datetime:
    return v.astimezone(UTC).replace(tzinfo=None) if v.tzinfo else v


class ActivityItem(BaseModel):
    mac: str
    session_start: datetime
    domain: str = Field(min_length=1, max_length=253)
    via: Literal["list", "follow"]
    pulled_by: str | None = Field(default=None, max_length=253)
    first_seen: datetime
    last_seen: datetime
    lookups: int = Field(ge=0, le=1_000_000)
    active_minutes: int = Field(ge=0, le=1440)

    @field_validator("mac")
    @classmethod
    def _mac(cls, v: str) -> str:
        v = v.strip().lower().replace("-", ":")
        if not MAC_RE.match(v):
            raise ValueError("MAC address must look like aa:bb:cc:dd:ee:ff.")
        return v

    _utc = field_validator("session_start", "first_seen", "last_seen")(_naive_utc)


class ActivityReport(BaseModel):
    items: list[ActivityItem] = Field(max_length=500)
