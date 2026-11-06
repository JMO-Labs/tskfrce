"""Integration install request schemas."""

from typing import Annotated

from pydantic import BaseModel, Field

SettingValue = Annotated[str, Field(max_length=200)] | int


class InstallIn(BaseModel):
    integration_id: str = Field(max_length=40)
    settings: dict[str, SettingValue]
    kid_ids: list[int] = Field(min_length=1)
    chore_ids: list[int] = []
    kid_widget_ids: list[int] = []
    accepted_permissions: list[str]


class InstallPatch(BaseModel):
    trusted: bool | None = None
    kid_widget_ids: list[int] | None = None
    resume: bool | None = None
