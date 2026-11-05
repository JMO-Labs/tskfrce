"""Fetch, sanitize and cache an install's widgets. Image URLs are rewritten to the box proxy."""

import json
import threading
import time
from collections import OrderedDict
from urllib.parse import quote

from sqlalchemy.orm import Session

from app.integrations import health, net, store
from app.integrations.manifest import load_manifest
from app.integrations.widgets import sanitize
from app.models.integration import IntegrationInstall

TTL = 60
IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}
IMAGE_MAX = 1_048_576
IMAGE_TTL = 300
IMAGE_LRU_ENTRIES, IMAGE_LRU_BYTES = 32, 16 * 1_048_576

# (install_id, surface, kid_id) -> (expires_at, widgets, original image URLs)
_cache: dict[tuple[int, str, int | None], tuple[float, list[dict], set[str]]] = {}
_lock = threading.Lock()  # sync routes run in a threadpool
# url -> (expires_at, content type, body); bounded by IMAGE_LRU_ENTRIES and IMAGE_LRU_BYTES
_images: OrderedDict[str, tuple[float, str, bytes]] = OrderedDict()


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
    def call(c):
        out = None
        if surface == "kid":  # the service sees only this kid
            kids = [k for k in c.ctx.grant_out["kids"] if k["id"] == kid_id]
            out = {**c.ctx.grant_out, "kids": kids}
        return sanitize(c.widgets(surface, kid_id, out).widgets, decls, surface, grant)

    got = health.guarded_call(db, install, call)
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
    with _lock:
        hit = _cache.get(key)
    if hit and hit[0] > now:
        return hit[1]
    widgets, images = _fetch(db, install, surface, kid_id)  # outside the lock: network
    with _lock:
        _cache[key] = (now + TTL, widgets, images)
    return widgets


def image_allowed(install_id: int, url: str, kid_id: int | None = None) -> bool:
    """True when a live cache entry of the install shows this image URL. With kid_id, only that
    kid's own kid-surface entry counts."""
    now = time.time()
    with _lock:
        if kid_id is not None:
            hit = _cache.get((install_id, "kid", kid_id))
            return bool(hit and hit[0] > now and url in hit[2])
        return any(k[0] == install_id and v[0] > now and url in v[2] for k, v in _cache.items())


def _sniff(body: bytes) -> str | None:
    """The image type the magic bytes show, or None."""
    if body.startswith(b"\x89PNG"):
        return "image/png"
    if body.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if body.startswith(b"GIF8"):
        return "image/gif"
    if body[:4] == b"RIFF" and body[8:12] == b"WEBP":
        return "image/webp"
    return None


def fetch_image(url: str, transport=None) -> tuple[str, bytes]:
    """GET url (STRICT, no cookies or Referer). The header type must be allowed and match the
    magic bytes, so SVG and mislabelled bodies are refused. Raises BlockedError or FetchError."""
    r = net.fetch("GET", url, max_bytes=IMAGE_MAX, transport=transport)
    ctype = r.content_type.split(";")[0].strip().lower()
    if ctype not in IMAGE_TYPES or _sniff(r.body) != ctype:
        raise net.FetchError("not an image")
    return ctype, r.body


def image(url: str) -> tuple[str, bytes]:
    """fetch_image through a small in-memory LRU. Errors are not cached."""
    now = time.time()
    with _lock:
        hit = _images.get(url)
        if hit and hit[0] > now:
            _images.move_to_end(url)
            return hit[1], hit[2]
    ctype, body = fetch_image(url)  # outside the lock: network
    with _lock:
        _images[url] = (now + IMAGE_TTL, ctype, body)
        _images.move_to_end(url)
        while len(_images) > IMAGE_LRU_ENTRIES or (
            sum(len(v[2]) for v in _images.values()) > IMAGE_LRU_BYTES
        ):
            _images.popitem(last=False)
    return ctype, body


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
    with _lock:
        hit = _cache.get((install_id, surface, kid_id))
    if not hit or hit[0] <= time.time():
        return None
    for w in hit[1]:
        if w["id"] == widget_id and (found := _find(w["root"], button_id)):
            return found
    return None


def forget(install_id: int) -> None:
    """Drop every cached widget of the install."""
    with _lock:
        for k in [k for k in _cache if k[0] == install_id]:
            del _cache[k]
