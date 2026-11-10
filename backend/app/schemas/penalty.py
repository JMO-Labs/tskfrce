"""Penalty request bodies and settings validation."""

from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints, field_validator, model_validator

RANGES = {"points": (1, 1000), "screen": (5, 600), "block": (60, 20160)}
Kind = Literal["points", "screen", "block"]
EarnBack = Literal["none", "half", "all"]


class _Amount(BaseModel):
    kind: Kind
    amount: int
    earn_back: EarnBack

    @model_validator(mode="after")
    def _range(self):
        lo, hi = RANGES[self.kind]
        if not lo <= self.amount <= hi:
            raise ValueError(f"amount for {self.kind} must be {lo}-{hi}")
        return self


class PenaltySize(_Amount):
    pass


class PenaltySizes(BaseModel):
    small: PenaltySize
    medium: PenaltySize
    big: PenaltySize


def check_sizes(v: dict | None) -> dict | None:
    return None if v is None else PenaltySizes(**v).model_dump()


class PenaltyIn(_Amount):
    kid_ids: list[int] = Field(min_length=1, max_length=20)
    reason: Annotated[str | None, StringConstraints(strip_whitespace=True, max_length=200)] = None
    device_id: int | None = None
    group_id: int | None = None
    makeup: (
        list[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]]
        | None
    ) = Field(default=None, max_length=5)
    chore_run_id: int | None = None
    notification_id: int | None = None

    @field_validator("reason")
    @classmethod
    def _blank(cls, v):
        return v or None

    @model_validator(mode="after")
    def _target(self):
        if self.device_id is not None and self.group_id is not None:
            raise ValueError("pick a device or a group, not both")
        if (self.device_id is not None or self.group_id is not None) and len(set(self.kid_ids)) > 1:
            raise ValueError("a device or group target needs exactly one kid")
        if self.makeup == [] and self.earn_back != "none":
            raise ValueError("Pick at least one make-up chore, or choose no earn-back.")
        return self


class ShortenIn(BaseModel):
    minutes: int = Field(ge=15, le=20160)
