"""Fetch, sanitize and cache an install's widgets. Image URLs are rewritten to the box proxy."""

import json
import time
from urllib.parse import quote

from sqlalchemy.orm import Session

from app.integrations import health, store
from app.integrations.manifest import load_manifest
from app.integrations.widgets import sanitize
from app.models.integration import IntegrationInstall

TTL = 60

# (install_id, surface, kid_id) -> (expires_at, widgets, original image URLs)
_cache: dict[tuple[int, str, int | None], tuple[float, list[dict], set[str]]] = {}


def _proxy(install_id: int, b: dict) -> None:
    if b["type"] == "image":
        b["url"] = f"/integration-widgets/{install_id}/image?u={quote(b['url'], safe='')}"
    for c in b.get("children", ()):
        _proxy(install_id, c)


def _fetch(db: Session, install: IntegrationInstall, surface: str, kid_id: int | None):
    grant = store.load_grant(db, install)
    if f"widgets.{surface}" not in grant.permissions:
        return [], set()
    if surface == "kid" and kid_id not in grant.kid_widget_ids:
        return [], set()
    decls = load_manifest(json.loads(install.manifest)).widgets
    # sanitize runs inside the guarded call so junk replies count as failures
    got = health.guarded_call(
        db, install, lambda c: sanitize(c.widgets(surface, kid_id).widgets, decls, surface, grant)
    )
    if got is None:
        return [], set()
    widgets, images = got
    for w in widgets:
        _proxy(install.id, w["root"])
    return widgets, images


def get(
    db: Session, install: IntegrationInstall, surface: str, kid_id: int | None, now: float
) -> list[dict]:
    """The install's clean widgets for surface (and kid), cached for TTL seconds. The caller
    commits (health may have changed)."""
    key = (install.id, surface, kid_id)
    hit = _cache.get(key)
    if hit and hit[0] > now:
        return hit[1]
    widgets, images = _fetch(db, install, surface, kid_id)
    _cache[key] = (now + TTL, widgets, images)
    return widgets


def image_allowed(install_id: int, url: str) -> bool:
    """True when a live cache entry of the install shows this image URL."""
    now = time.time()
    return any(k[0] == install_id and v[0] > now and url in v[2] for k, v in _cache.items())


def _find(b: dict, button_id: str) -> dict | None:
    if b["type"] == "button":
        return b if b["id"] == button_id else None
    for c in b.get("children", ()):
        if found := _find(c, button_id):
            return found
    return None


def button(
    install_id: int, surface: str, kid_id: int | None, widget_id: str, button_id: str
) -> dict | None:
    """The button as last shown on this surface, or None."""
    hit = _cache.get((install_id, surface, kid_id))
    if not hit or hit[0] <= time.time():
        return None
    for w in hit[1]:
        if w["id"] == widget_id and (found := _find(w["root"], button_id)):
            return found
    return None


def forget(install_id: int) -> None:
    """Drop every cached widget of the install."""
    for k in [k for k in _cache if k[0] == install_id]:
        del _cache[k]
