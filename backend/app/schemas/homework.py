"""Homework mode request bodies."""

from typing import Literal

from pydantic import BaseModel, Field


class SiteIn(BaseModel):
    domain: str = Field(max_length=2048)
    kind: Literal["allow", "block"]
    kid_id: int | None = None
