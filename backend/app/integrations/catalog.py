"""Box side of the signed registry catalog: verified sync, rollback guard and revocation.

The registry being down never stops installed integrations: the last verified catalog stays
cached and revocations apply on the next successful sync. A fetched catalog must carry an
issued_at strictly newer than the cached one, so a replayed old (validly signed) catalog
cannot undo a revocation.
"""

import json
import logging
import os
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
from sqlalchemy.orm import Session

from app.core.config import settings
from app.integrations import net, store
from app.integrations.manifest import Manifest, load_manifest
from app.integrations.trust import UntrustedError, verify_envelope
from app.models.integration import IntegrationInstall
from app.services import inbox

log = logging.getLogger(__name__)
MAX_BYTES = 1_048_576
SYNC_EVERY = timedelta(hours=6)
FIRST_RETRY = timedelta(seconds=60)


@dataclass(frozen=True)
class Catalog:
    issued_at: datetime
    manifests: dict[str, tuple[Manifest, dict]]
    revoked: frozenset[str]


def catalog_path() -> Path:
    return settings.DATA_DIR / "integrations" / "catalog.json"


def _issued_at(v) -> datetime:
    if not isinstance(v, str):
        raise UntrustedError("issued_at missing")
    try:
        at = datetime.fromisoformat(v)
    except ValueError as e:
        raise UntrustedError("bad issued_at") from e
    if at.tzinfo is None:
        raise UntrustedError("issued_at needs a timezone")
    return at.astimezone(UTC).replace(tzinfo=None)


def parse_catalog(env: dict) -> Catalog:
    """Verify the outer envelope (UntrustedError propagates); skip bad manifests one by one."""
    body = verify_envelope(env)
    items, revoked = body.get("integrations"), body.get("revoked")
    if body.get("v") != 1 or not isinstance(items, list) or not isinstance(revoked, list):
        raise UntrustedError("bad catalog shape")
    if not all(isinstance(r, str) for r in revoked):
        raise UntrustedError("bad revoked list")
    manifests: dict[str, tuple[Manifest, dict]] = {}
    for menv in items:
        try:
            m = load_manifest(menv)
        except Exception as e:  # one bad entry must not hide the rest
            log.warning("Catalog manifest skipped: %s", type(e).__name__)
            continue
        manifests[m.id] = (m, menv)
    return Catalog(_issued_at(body.get("issued_at")), manifests, frozenset(revoked))


def cached() -> Catalog | None:
    """The last verified catalog, re-verified on every load. None when missing or untrusted."""
    try:
        return parse_catalog(json.loads(catalog_path().read_text()))
    except (OSError, ValueError, UntrustedError):
        return None


def _write(env: dict) -> None:
    path = catalog_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(env, f)
    os.chmod(tmp, 0o600)  # O_CREAT mode is ignored when tmp already existed
    os.replace(tmp, path)


def _revoke(db: Session, revoked: frozenset[str]) -> None:
    if not revoked:
        return
    rows = (
        db.query(IntegrationInstall)
        .filter(
            IntegrationInstall.integration_id.in_(revoked),
            IntegrationInstall.status.in_(("active", "paused")),
        )
        .all()
    )
    for install in rows:
        store.retire(db, install, "revoked")
        inbox.notify_parents(
            db,
            "integration_paused",
            f"{install.name} was turned off",
            "t@sk4ce turned it off for safety. Its history is kept.",
        )
    db.commit()


def sync(db: Session, now: datetime, transport: httpx.BaseTransport | None = None) -> bool:
    """Fetch, verify and cache the catalog, then apply revocations. False keeps the cache."""
    try:
        resp = net.fetch(
            "GET",
            f"{settings.REGISTRY_URL}/api/integrations/catalog",
            policy=net.STRICT,
            max_bytes=MAX_BYTES,
            transport=transport,
        )
        env = json.loads(resp.body)
        if not isinstance(env, dict):
            raise UntrustedError("envelope is not an object")
        new = parse_catalog(env)
    except Exception as e:
        log.warning("Catalog sync failed: %s", e)
        return False
    old = cached()
    if old is not None and new.issued_at <= old.issued_at:
        log.warning("Catalog sync rejected: issued_at %s is not newer", new.issued_at)
        return False
    _revoke(db, new.revoked)  # first: a failure here leaves the cache old, so the next sync retries
    _write(env)
    return True


class SyncSchedule:
    """Every 6 h after a success; after a failure retry in 60 s, doubling up to 6 h."""

    def __init__(self) -> None:
        self.next_at: datetime | None = None
        self._delay: timedelta | None = None

    def due(self, now: datetime) -> bool:
        return self.next_at is None or now >= self.next_at

    def mark(self, ok: bool, now: datetime) -> None:
        if ok:
            self._delay = None
            self.next_at = now + SYNC_EVERY
            return
        self._delay = FIRST_RETRY if self._delay is None else min(self._delay * 2, SYNC_EVERY)
        self.next_at = now + self._delay


_schedule = SyncSchedule()


def sync_step(db: Session, now: datetime) -> None:
    """Loop step: sync when due."""
    if _schedule.due(now):
        _schedule.mark(sync(db, now), now)
