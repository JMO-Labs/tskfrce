"""Integration manifest model (loaded only from a verified envelope)."""

import ipaddress
import socket
from typing import Annotated, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.integrations.permissions import PERMS
from app.integrations.trust import verify_envelope


def _is_ip(host: str) -> bool:
    """True for any form libc may resolve as an IP (dotted, short, decimal, hex, IPv6)."""
    for f in (ipaddress.ip_address, socket.inet_aton):
        try:
            f(host)
            return True
        except (ValueError, OSError):
            pass
    return False


class SettingField(BaseModel):
    model_config = ConfigDict(extra="forbid")
    key: str = Field(pattern=r"^[a-z_]{1,32}$")
    label: str = Field(max_length=60)
    type: Literal["text", "username", "number", "select"]
    options: list[Annotated[str, Field(max_length=100)]] = Field(
        default_factory=list, max_length=20
    )
    secret: bool = False
    required: bool = True

    @model_validator(mode="after")
    def _options(self):
        if (self.type == "select") != bool(self.options):
            raise ValueError("options are required for select fields and only for them")
        return self


class WidgetDecl(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(pattern=r"^[a-z0-9_]{1,32}$")
    surface: Literal["parent", "kid"]
    title: str = Field(max_length=40)


class Manifest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{2,39}$")
    name: str = Field(max_length=40)
    developer: str = Field(max_length=60)
    description: str = Field(max_length=300)
    icon: str = Field(pattern=r"^[a-z0-9_]{1,40}$")
    version: str = Field(pattern=r"^\d+\.\d+\.\d+$")
    protocol: Literal["v1"]
    base_url: str
    poll_seconds: int | None = Field(default=None, ge=60, le=86400)
    settings: list[SettingField] = Field(default_factory=list, max_length=10)
    permissions: list[str] = Field(default_factory=list)
    widgets: list[WidgetDecl] = Field(default_factory=list, max_length=6)

    @field_validator("base_url")
    @classmethod
    def _base_url(cls, v: str) -> str:
        u = urlsplit(v)
        if u.scheme != "https" or "@" in u.netloc or u.query or u.fragment or "?" in v or "#" in v:
            raise ValueError("base_url must be plain https without userinfo, query or fragment")
        try:
            port = u.port
        except ValueError as e:
            raise ValueError("bad port") from e
        if port not in (None, 443):
            raise ValueError("base_url port must be 443")
        host = u.hostname
        if not host:
            raise ValueError("base_url needs a host")
        last = host.rsplit(".", 1)[-1].lower()
        if last.isdigit() or last.startswith("0x") or _is_ip(host):
            raise ValueError("base_url host must not be an IP literal")
        return v

    @field_validator("permissions")
    @classmethod
    def _perms(cls, v: list[str]) -> list[str]:
        if len(set(v)) != len(v) or not set(v) <= set(PERMS):
            raise ValueError("permissions must be unique and known")
        return v

    @model_validator(mode="after")
    def _widget_perms(self):
        for w in self.widgets:
            if f"widgets.{w.surface}" not in self.permissions:
                raise ValueError(f"{w.surface} widget needs widgets.{w.surface}")
        return self


def load_manifest(env: dict) -> Manifest:
    return Manifest.model_validate(verify_envelope(env))
