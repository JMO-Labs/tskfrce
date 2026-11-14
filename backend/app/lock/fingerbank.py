"""Device class from a DHCP fingerprint via Fingerbank (offline DB; cloud only when opted in)."""

import logging
import sqlite3

import httpx

from app.core.config import settings

log = logging.getLogger(__name__)
# httpx logs full request URLs at INFO; the API key travels in the query string.
logging.getLogger("httpx").setLevel(logging.WARNING)
API = "https://api.fingerbank.org/api/v2/combinations/interrogate"
_cache: dict[tuple, tuple[str, int] | None] = {}
_FAMILIES = (  # substring of the class path (lowercase) -> OS family
    ("android", "android"),
    ("ios", "ios"),
    ("ipados", "ios"),
    ("windows", "windows"),
    ("mac os", "macos"),
    ("macos", "macos"),
    ("linux", "linux"),
    ("ubuntu", "linux"),
)
_FRIENDLY = {"android": "Android device", "ios": "Apple iOS device", "windows": "Windows PC",
             "macos": "Mac", "linux": "Linux computer"}  # fmt: skip


def cache_clear() -> None:
    _cache.clear()


def os_family(path: str | None) -> str | None:
    """OS family of a class path like 'Operating System/Google OS/Android OS', else None."""
    if not path or not path.lower().startswith("operating system"):
        return None
    low = path.lower().replace("apple ios", "ios")
    return next((fam for key, fam in _FAMILIES if key in low), None)


def friendly_name(path: str | None) -> str | None:
    """Short display name for a class path."""
    if not path:
        return None
    return _FRIENDLY.get(os_family(path) or "") or path.rsplit("/", 1)[-1]


def _offline(fp: str, db_path: str) -> tuple[str, int] | None:
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        row = con.execute(
            "select c.device_id, c.score from combination c join dhcp_fingerprint f "
            "on f.id = c.dhcp_fingerprint_id where f.value = ? "
            "order by c.score desc limit 1",
            (fp,),
        ).fetchone()
        if not row:
            return None
        names, did = [], row[0]
        while did is not None and len(names) < 20:
            q = "select name, parent_id from device where id = ?"
            name, did = con.execute(q, (did,)).fetchone()
            names.append(name)
        return "/".join(reversed(names)), int(row[1])
    finally:
        con.close()


def _cloud(fp: str, hostname: str | None) -> tuple[str, int] | None:
    params = {"key": settings.FINGERBANK_API_KEY, "dhcp_fingerprint": fp}
    if hostname:
        params["hostname"] = hostname
    r = httpx.get(API, params=params, timeout=5)
    r.raise_for_status()
    j = r.json()
    dev = j.get("device") or {}
    if not dev.get("name"):
        return None
    names = [dev["name"], *(p["name"] for p in dev.get("parents", []))]
    return "/".join(reversed(names)), int(j.get("score") or 0)


def _lookup(fp: str, hostname: str | None) -> tuple[str, int] | None:
    if settings.FINGERBANK_DB_PATH:
        return _offline(fp, settings.FINGERBANK_DB_PATH)
    if settings.FINGERBANK_CLOUD and settings.FINGERBANK_API_KEY:
        return _cloud(fp, hostname)
    return None


def lookup(fp: str | None, hostname: str | None = None) -> tuple[str, int] | None:
    """(class path, score) or None. Cached; never raises."""
    if not fp:
        return None
    key = (fp, hostname if settings.FINGERBANK_CLOUD else None, bool(settings.FINGERBANK_DB_PATH))
    if key in _cache:
        return _cache[key]
    try:
        res = _lookup(fp, hostname)
    except Exception as e:  # noqa: BLE001 - discovery must never depend on this
        log.warning("fingerbank lookup failed: %s", type(e).__name__)
        return None
    _cache[key] = res
    return res
