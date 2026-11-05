"""Box catalog sync: verified, monotonic, revocation through store.retire, and the loop."""

import json
import os
from datetime import UTC, datetime, timedelta

import pytest
from app.integrations import catalog as cat
from app.integrations import loop
from app.integrations.catalog import SyncSchedule, cached, catalog_path, sync
from app.models.inbox import Notification
from app.models.integration import IntegrationAction, IntegrationEvent
from app.models.reward import Reward
from sqlalchemy.exc import OperationalError
from tests.integrations.int_helpers import DEMO, other_signer, sign_env

NOW = datetime.now(UTC).replace(tzinfo=None, microsecond=0)  # catalog() stamps the real clock
T1 = NOW - timedelta(hours=2)
T2 = NOW - timedelta(hours=1)


@pytest.fixture(autouse=True)
def data_dir(monkeypatch, tmp_path):
    from app.core.config import settings

    monkeypatch.setattr(settings, "DATA_DIR", tmp_path)
    return tmp_path


def test_sync_caches_and_lists(db, keypair, registry):
    registry.serve(keypair.catalog([DEMO]))
    assert sync(db, NOW, transport=registry.transport) is True
    assert "demo" in cached().manifests
    assert registry.path == "/api/integrations/catalog"
    assert os.stat(catalog_path()).st_mode & 0o777 == 0o600


def test_bad_signature_keeps_previous_catalog(db, keypair, registry):
    registry.serve(keypair.catalog([DEMO]))
    sync(db, NOW, transport=registry.transport)
    registry.serve(other_signer().catalog([]))
    assert sync(db, NOW, transport=registry.transport) is False
    assert "demo" in cached().manifests


def test_registry_down_keeps_installs_running(db, install, registry):
    registry.fail()
    assert sync(db, NOW, transport=registry.transport) is False and install.status == "active"
    assert cached() is None


def test_registry_down_keeps_cached_catalog(db, keypair, registry):
    registry.serve(keypair.catalog([DEMO]))
    sync(db, NOW, transport=registry.transport)
    registry.fail()
    assert sync(db, NOW, transport=registry.transport) is False
    assert "demo" in cached().manifests


def test_revocation_disables_install_and_drops_secret(db, keypair, registry, install):
    registry.serve(keypair.catalog([DEMO], revoked=["demo"]))
    sync(db, NOW, transport=registry.transport)
    db.refresh(install)
    assert install.status == "revoked" and install.secret is None
    n = db.query(Notification).filter_by(kind="integration_paused").all()
    assert n and n[0].title == "Demo was turned off"
    assert n[0].body == "t@sk4ce turned it off for safety. Its history is kept."
    assert "demo" in cached().revoked


def test_revocation_removes_rewards_and_events(db, keypair, registry, install):
    db.add(Reward(name="Owned", price=5, integration_install_id=install.id, integration_ref="r1"))
    db.add(IntegrationEvent(install_id=install.id, kind="chore.completed", payload="{}"))
    db.add(
        IntegrationAction(
            install_id=install.id, idempotency_key="k1", kind="chore.complete", result="applied"
        )
    )
    db.commit()
    registry.serve(keypair.catalog([DEMO], revoked=["demo"]))
    sync(db, NOW, transport=registry.transport)
    assert db.query(Reward).filter_by(integration_ref="r1").one().active is False
    assert db.query(IntegrationEvent).count() == 0
    assert db.query(IntegrationAction).count() == 1  # audit log is kept


def test_revocation_skips_already_removed(db, keypair, registry, install):
    install.status = "removed"
    db.commit()
    registry.serve(keypair.catalog([DEMO], revoked=["demo"]))
    assert sync(db, NOW, transport=registry.transport) is True
    db.refresh(install)
    assert install.status == "removed"
    assert db.query(Notification).filter_by(kind="integration_paused").count() == 0


def test_older_catalog_is_ignored(db, keypair, registry):
    registry.serve(keypair.catalog([DEMO], issued_at=T2))
    sync(db, NOW, transport=registry.transport)
    registry.serve(keypair.catalog([], issued_at=T1))
    assert sync(db, NOW, transport=registry.transport) is False and "demo" in cached().manifests


def test_replayed_catalog_cannot_undo_revocation(db, keypair, registry, install):
    """A validly signed pre-revocation catalog (same or older issued_at) is rejected."""
    old = keypair.catalog([DEMO], issued_at=T1)
    registry.serve(old)
    assert sync(db, NOW, transport=registry.transport) is True
    registry.serve(keypair.catalog([DEMO], revoked=["demo"], issued_at=T2))
    assert sync(db, NOW, transport=registry.transport) is True
    for replay in (old, keypair.catalog([DEMO], issued_at=T2)):
        registry.serve(replay)
        assert sync(db, NOW, transport=registry.transport) is False
        assert cached().issued_at == T2 and "demo" in cached().revoked
    db.refresh(install)
    assert install.status == "revoked"


def test_bad_manifest_skipped_rest_load(db, keypair, registry):
    other = {**DEMO, "id": "other", "name": "Other"}
    body = {
        "v": 1,
        "issued_at": T1.isoformat() + "Z",
        "integrations": [
            other_signer().sign(DEMO),
            sign_env({**DEMO, "id": "X!"}),
            sign_env(other),
        ],
        "revoked": [],
    }
    registry.serve(keypair.sign(body))
    assert sync(db, NOW, transport=registry.transport) is True
    assert set(cached().manifests) == {"other"}


def test_tampered_cache_is_untrusted(db, keypair, registry):
    registry.serve(keypair.catalog([DEMO]))
    sync(db, NOW, transport=registry.transport)
    env = json.loads(catalog_path().read_text())
    env["payload"] = env["payload"][:-4] + "AAAA"
    catalog_path().write_text(json.dumps(env))
    assert cached() is None


def test_backoff_doubles_to_six_hours():
    s = SyncSchedule()
    t = NOW
    assert s.due(t)
    delays = []
    for _ in range(12):
        s.mark(False, t)
        delays.append((s.next_at - t).total_seconds())
        t = s.next_at
    assert delays[:3] == [60, 120, 240] and max(delays) == 21600
    s.mark(True, t)
    assert s.next_at - t == timedelta(hours=6) and not s.due(t)
    s.mark(False, t)
    assert (s.next_at - t).total_seconds() == 60


def test_loop_step_syncs_when_due(monkeypatch, keypair):
    calls = []
    monkeypatch.setattr(cat, "_schedule", SyncSchedule())
    monkeypatch.setattr(cat, "sync", lambda db, now: calls.append(now) or True)
    cat.sync_step(None, NOW)
    cat.sync_step(None, NOW + timedelta(hours=1))
    assert calls == [NOW]


def test_run_once_survives_failing_steps(monkeypatch):
    ran = []

    def locked(db, now):
        raise OperationalError("x", {}, Exception("database is locked"))

    def boom(db, now):
        raise RuntimeError("boom")

    monkeypatch.setattr(loop, "STEPS", [locked, boom, lambda db, now: ran.append(now)])
    loop._run_once(NOW)
    assert ran == [NOW]


def test_catalog_sync_is_first_step():
    assert loop.STEPS[0] is cat.sync_step


def test_write_fsyncs_before_replace(db, keypair, registry, monkeypatch):
    order = []
    real_fsync, real_replace = os.fsync, os.replace
    monkeypatch.setattr(cat.os, "fsync", lambda fd: order.append("fsync") or real_fsync(fd))
    monkeypatch.setattr(
        cat.os, "replace", lambda a, b: order.append("replace") or real_replace(a, b)
    )
    registry.serve(keypair.catalog([DEMO]))
    assert sync(db, NOW, transport=registry.transport) is True
    assert order[0] == "fsync" and "replace" in order


def test_far_future_catalog_is_rejected(db, keypair, registry, caplog):
    registry.serve(keypair.catalog([DEMO], issued_at=T1))
    sync(db, NOW, transport=registry.transport)
    registry.serve(keypair.catalog([], revoked=["demo"], issued_at=NOW + timedelta(hours=25)))
    assert sync(db, NOW, transport=registry.transport) is False
    assert cached().issued_at == T1 and "demo" in cached().manifests
    assert "future" in caplog.text


def test_slightly_future_catalog_is_accepted(db, keypair, registry):
    registry.serve(keypair.catalog([DEMO], issued_at=NOW + timedelta(hours=23)))
    assert sync(db, NOW, transport=registry.transport) is True


def test_sync_error_still_backs_off(monkeypatch):
    s = SyncSchedule()
    monkeypatch.setattr(cat, "_schedule", s)

    def boom(db, now):
        raise OperationalError("x", {}, Exception("database is locked"))

    monkeypatch.setattr(cat, "sync", boom)
    with pytest.raises(OperationalError):
        cat.sync_step(None, NOW)
    assert s.next_at == NOW + timedelta(seconds=60)
