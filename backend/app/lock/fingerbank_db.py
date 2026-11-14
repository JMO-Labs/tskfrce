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
    """Point lookups at the DB (or off) according to the family setting."""
    on = bool(fam.fingerbank_enabled)
    path = str(db_file()) if on and db_file().exists() else None
    cloud = on and bool(fam.fingerbank_cloud) and bool(fam.fingerbank_api_key)
    if (path, cloud) != (settings.FINGERBANK_DB_PATH, settings.FINGERBANK_CLOUD):
        fingerbank.cache_clear()
    settings.FINGERBANK_DB_PATH = path
    settings.FINGERBANK_CLOUD = cloud
    settings.FINGERBANK_API_KEY = fam.fingerbank_api_key if cloud else None


def _due(fam) -> bool:
    if not (fam.fingerbank_enabled and fam.fingerbank_api_key):
        return False
    if not db_file().exists() or not fam.fingerbank_synced_at:
        return True
    return datetime.now(UTC).replace(tzinfo=None) - fam.fingerbank_synced_at >= MAX_AGE


def refresh(db, force: bool = False) -> bool:
    """Download when enabled and due. A failure keeps the old DB. True if a new DB landed."""
    fam = get_family(db)
    apply(fam)
    if not _due(fam) and not (force and fam.fingerbank_enabled and fam.fingerbank_api_key):
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
        log.warning("fingerbank download failed: %s", type(e).__name__)
        tmp.unlink(missing_ok=True)
        return False
    finally:
        _lock.release()
    fam.fingerbank_synced_at = datetime.now(UTC).replace(tzinfo=None)
    db.commit()
    apply(fam)
    fingerbank.cache_clear()
    return True


def tick(db) -> None:
    """Called from the background loop: cheap unless a download is due (then in a thread)."""
    fam = get_family(db)
    apply(fam)
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
