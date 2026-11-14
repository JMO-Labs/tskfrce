"""Provision the offline Fingerbank DB with the parent's own key (opt-in, refreshed weekly)."""

import logging
import sqlite3
import threading
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx

from app.core.config import settings
from app.lock import fingerbank
from app.models.family import get_family

log = logging.getLogger(__name__)
URL = "https://api.fingerbank.org/api/v2/download/db"
MAX_AGE = timedelta(days=7)
_lock = threading.Lock()
RETRY = timedelta(hours=1)
RETRY_BAD_KEY = timedelta(days=1)
# env/compose values stay in force unless the family setting provides its own
_ENV = (settings.FINGERBANK_DB_PATH, settings.FINGERBANK_CLOUD, settings.FINGERBANK_API_KEY)


def db_file() -> Path:
    return settings.DATA_DIR / "fingerbank.sqlite"


def _download(key: str, dest: Path) -> None:
    with httpx.stream("GET", URL, params={"key": key}, timeout=120, follow_redirects=True) as r:
        r.raise_for_status()
        with dest.open("wb") as f:
            for chunk in r.iter_bytes():
                f.write(chunk)


def _valid(path: Path) -> bool:
    try:
        con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        try:
            con.execute("select 1 from combination limit 1").fetchone()
            con.execute("select 1 from dhcp_fingerprint limit 1").fetchone()
            con.execute("select 1 from device limit 1").fetchone()
        finally:
            con.close()
        return True
    except sqlite3.Error:
        return False


def apply(fam) -> None:
    """Point lookups at the DB, the cloud (a choice, not both) or off per the family setting."""
    on = bool(fam.fingerbank_enabled) and bool(fam.fingerbank_api_key)
    cloud_mode = on and bool(fam.fingerbank_cloud)
    if cloud_mode:
        path, cloud, key = None, True, fam.fingerbank_api_key
    elif on and db_file().exists():
        path, cloud, key = str(db_file()), False, None
    else:
        path, cloud, key = _ENV
    if (path, cloud) != (settings.FINGERBANK_DB_PATH, settings.FINGERBANK_CLOUD):
        fingerbank.cache_clear()
        fingerbank.cloud_reset()
    settings.FINGERBANK_DB_PATH = path
    settings.FINGERBANK_CLOUD = cloud
    settings.FINGERBANK_API_KEY = key


def _naive_now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _due(fam) -> bool:
    if not (fam.fingerbank_enabled and fam.fingerbank_api_key) or fam.fingerbank_cloud:
        return False
    if fam.fingerbank_last_error and fam.fingerbank_attempted_at:
        wait = RETRY_BAD_KEY if fam.fingerbank_last_error == "bad_key" else RETRY
        if _naive_now() - fam.fingerbank_attempted_at < wait:
            return False  # failed recently: do not hammer api.fingerbank.org
    if not db_file().exists() or not fam.fingerbank_synced_at:
        return True
    return _naive_now() - fam.fingerbank_synced_at >= MAX_AGE


def _fail(db, fam, code: str) -> None:
    fam.fingerbank_attempted_at = fam.fingerbank_last_error_at = _naive_now()
    fam.fingerbank_last_error = code
    db.commit()


def refresh(db, force: bool = False) -> bool:
    """Download when enabled and due. A failure keeps the old DB. True if a new DB landed."""
    fam = get_family(db)
    apply(fam)
    can = fam.fingerbank_enabled and fam.fingerbank_api_key and not fam.fingerbank_cloud
    if not (_due(fam) or (force and can)):
        return False
    if not _lock.acquire(blocking=False):
        return False
    tmp = db_file().with_suffix(".sqlite.tmp")
    try:
        _download(fam.fingerbank_api_key, tmp)
        if not _valid(tmp):
            raise ValueError("not a Fingerbank database")
        tmp.replace(db_file())
    except Exception as e:  # noqa: BLE001 - never block discovery; keep the old DB
        code = "invalid_db" if isinstance(e, ValueError) else fingerbank.error_code(e)
        log.warning("fingerbank download failed: %s", code)  # never the URL: it holds the key
        tmp.unlink(missing_ok=True)
        _fail(db, fam, code)
        return False
    finally:
        _lock.release()
    fam.fingerbank_synced_at = fam.fingerbank_attempted_at = _naive_now()
    fam.fingerbank_last_error = fam.fingerbank_last_error_at = None
    db.commit()
    apply(fam)
    fingerbank.cache_clear()
    return True


def _sync_cloud_error(db, fam) -> None:
    """Persist the last cloud lookup failure (or its recovery) for the settings card."""
    err = fingerbank.cloud_error
    if err and fam.fingerbank_last_error != err:
        _fail(db, fam, err)
    elif not err and (fam.fingerbank_last_error or "").startswith("cloud_"):
        fam.fingerbank_last_error = fam.fingerbank_last_error_at = None
        db.commit()


def tick(db) -> None:
    """Called from the background loop: cheap unless a download is due (then in a thread)."""
    fam = get_family(db)
    apply(fam)
    _sync_cloud_error(db, fam)
    if _due(fam) and not _lock.locked():
        threading.Thread(target=_bg, daemon=True).start()


def _bg() -> None:
    from app.core.database import SessionLocal

    db = SessionLocal()
    try:
        refresh(db)
    except Exception as e:  # noqa: BLE001
        log.warning("fingerbank refresh failed: %s", type(e).__name__)
    finally:
        db.close()
