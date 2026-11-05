"""Declarative widget blocks and the sanitizer (DB-free). Strings are plain text, never markup."""

import logging
from typing import Annotated, Literal
from urllib.parse import urlsplit

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, ValidationError

from app.integrations.client import ProtocolError
from app.integrations.manifest import WidgetDecl
from app.integrations.permissions import ACTION_PERM, KID_BUTTON_ACTIONS, Grant

log = logging.getLogger(__name__)

MAX_DEPTH = 3
MAX_BLOCKS = 40
MAX_WIDGETS = 6


def _https(v: str) -> str:
    u = urlsplit(v)
    if u.scheme != "https" or "@" in u.netloc or not u.hostname:
        raise ValueError("must be https without userinfo")
    return v


Https = Annotated[str, AfterValidator(_https)]


def Short(n: int):  # noqa: N802 - reads as a type
    return Annotated[str, Field(max_length=n)]


class _B(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Card(_B):
    type: Literal["card"]
    title: Short(60) | None = None
    children: list["Block"] = Field(default_factory=list, max_length=20)


class Text(_B):
    type: Literal["text"]
    text: Short(200)
    tone: Literal["normal", "muted", "good", "warn"] = "normal"
    link: Https | None = None


class ListBlock(_B):
    type: Literal["list"]
    items: list[Short(100)] = Field(max_length=10)


class Stat(_B):
    type: Literal["stat"]
    label: Short(40)
    value: Short(20)


class Progress(_B):
    type: Literal["progress"]
    label: Short(40)
    value: float = Field(ge=0)
    max: float = Field(gt=0)


class Image(_B):
    type: Literal["image"]
    url: Https
    alt: Short(100)


class Button(_B):
    type: Literal["button"]
    id: str = Field(pattern=r"^[a-z0-9_]{1,32}$")
    label: Short(30)
    action: Literal[tuple(ACTION_PERM)]  # type: ignore[valid-type]


Block = Annotated[
    Card | Text | ListBlock | Stat | Progress | Image | Button, Field(discriminator="type")
]
Card.model_rebuild()


class Widget(_B):
    id: str
    root: Block


def _size(b, depth: int = 1) -> tuple[int, int]:
    """(deepest level, block count) of the tree under b."""
    if not isinstance(b, Card):
        return depth, 1
    deep, n = depth, 1
    for c in b.children:
        d, k = _size(c, depth + 1)
        deep, n = max(deep, d), n + k
    return deep, n


def _prune(b, ok_actions: set[str], images: set[str]):
    """Drop disallowed buttons; collect image URLs. None when b itself is dropped."""
    if isinstance(b, Button):
        return b if b.action in ok_actions else None
    if isinstance(b, Image):
        images.add(b.url)
    if isinstance(b, Card):
        b.children = [c for c in (_prune(c, ok_actions, images) for c in b.children) if c]
    return b


def _clean(w, declared: set[str], ok_actions: set[str], images: set[str]) -> dict | str:
    """The clean widget, or why it was dropped."""
    wid = w.get("id") if isinstance(w, dict) else None
    if not isinstance(wid, str) or wid not in declared:
        return "not declared for this surface"
    try:
        widget = Widget.model_validate(w)
    except ValidationError as e:
        return f"invalid ({e.error_count()} errors)"
    deep, n = _size(widget.root)
    if deep > MAX_DEPTH or n > MAX_BLOCKS:
        return "too deep or too big"
    seen: set[str] = set()
    widget.root = _prune(widget.root, ok_actions, seen)
    if widget.root is None:
        return "nothing left to show"
    images |= seen
    return widget.model_dump(mode="json")


def sanitize(
    raw: list[dict], decls: list[WidgetDecl], surface: Literal["parent", "kid"], grant: Grant
) -> tuple[list[dict], set[str]]:
    """Clean widgets for surface plus the image URLs they show. Bad widgets are dropped and
    logged; ProtocolError when there are too many or every one was dropped."""
    if len(raw) > MAX_WIDGETS:
        raise ProtocolError("bad widgets")
    declared = {d.id for d in decls if d.surface == surface}
    ok_actions = {a for a, p in ACTION_PERM.items() if p in grant.permissions}
    if surface == "kid":
        ok_actions &= KID_BUTTON_ACTIONS
    out: list[dict] = []
    images: set[str] = set()
    for w in raw:
        r = _clean(w, declared, ok_actions, images)
        if isinstance(r, str):
            wid = w.get("id") if isinstance(w, dict) else None
            log.warning("integration %s: dropped widget %.40r: %s", grant.install_id, wid, r)
        else:
            out.append(r)
    if raw and not out:
        raise ProtocolError("bad widgets")
    return out, images
