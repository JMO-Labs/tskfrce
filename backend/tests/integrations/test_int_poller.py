"""Poller: per-install interval, who is skipped, isolation, reply actions."""

import json
from datetime import UTC, datetime, timedelta

from app.integrations import loop, poller
from app.integrations.manifest import load_manifest
from app.integrations.poller import poll_due
from tests.integrations.int_helpers import boom, cc

NOW = datetime.now(UTC).replace(tzinfo=None)


def _secret(install):
    from app.core.crypto import unseal

    return unseal(install.secret, purpose="integrations")


def test_due_install_is_polled_and_actions_applied(db, install, svc, kid, run_today):
    svc.secret = _secret(install)
    install.next_poll_at = NOW
    svc.actions = [cc("p1", kid.id, run_today.chore_id)]
    db.commit()
    poll_due(db, NOW)
    assert svc.last_path == "/v1/poll" and run_today.status == "submitted"
    assert install.next_poll_at == NOW + timedelta(seconds=60)


def test_not_due_not_polled(db, install, svc):
    install.next_poll_at = NOW + timedelta(seconds=1)
    db.commit()
    poll_due(db, NOW)
    assert svc.calls == 0


def test_no_poll_interval_never_polled(db, install, svc):
    install.next_poll_at = None
    db.commit()
    poll_due(db, NOW)
    assert svc.calls == 0


def test_paused_revoked_and_local_never_polled(db, install, svc):
    for status, source in [("paused", "catalog"), ("revoked", "catalog"), ("active", "local")]:
        install.status, install.source, install.next_poll_at = status, source, NOW
        db.commit()
        poll_due(db, NOW)
        assert svc.calls == 0


def test_failures_still_reschedule_and_pause_at_five(db, install, svc):
    svc.secret = _secret(install)
    svc.fail()
    t = NOW
    for _ in range(5):
        install.next_poll_at = t
        db.commit()
        poll_due(db, t)
        assert install.next_poll_at == t + timedelta(seconds=60)
        t += timedelta(seconds=60)
    assert install.status == "paused"


def test_tampered_stored_manifest_pauses(db, install):
    install.manifest = json.dumps({"payload": "e30=", "sig": "AAAA"})
    install.next_poll_at = NOW
    db.commit()
    poll_due(db, NOW)
    assert install.status == "paused" and install.paused_reason == "bad manifest"


def test_bad_manifest_pause_tells_parents_and_drops_widgets(db, install):
    from app.integrations import widget_service
    from app.models.inbox import Notification

    widget_service._cache[(install.id, "parent", None)] = (9e12, [{"id": "w"}], set())
    install.manifest = json.dumps({"payload": "e30=", "sig": "AAAA"})
    install.next_poll_at = NOW
    db.commit()
    poll_due(db, NOW)
    assert db.query(Notification).filter_by(kind="integration_paused").count() == 1
    assert widget_service.button(install.id, "parent", None, "w", "b") is None
    assert not [k for k in widget_service._cache if k[0] == install.id]


def test_interval_never_below_60(db, install):
    assert poller.interval(install) >= 60


def test_one_failing_install_does_not_block_others(db, install, svc, monkeypatch):
    svc.secret = _secret(install)
    from app.models.integration import IntegrationInstall

    two = IntegrationInstall(
        **{
            c.name: getattr(install, c.name)
            for c in IntegrationInstall.__table__.columns
            if c.name not in ("id", "public_id")
        },
        public_id="b" * 32,
    )
    db.add(two)
    install.next_poll_at = NOW - timedelta(seconds=5)
    two.next_poll_at = NOW
    db.commit()
    real = poller._poll
    n = {"i": 0}

    def flaky(db_, inst, now):
        n["i"] += 1
        if n["i"] == 1:
            boom()
        real(db_, inst, now)

    monkeypatch.setattr(poller, "_poll", flaky)
    db.commit()
    poll_due(db, NOW)
    assert n["i"] == 2 and svc.calls >= 1


def test_at_most_max_per_tick(db, install, svc, monkeypatch):
    monkeypatch.setattr(poller, "MAX_PER_TICK", 1)
    from app.models.integration import IntegrationInstall

    two = IntegrationInstall(
        **{
            c.name: getattr(install, c.name)
            for c in IntegrationInstall.__table__.columns
            if c.name not in ("id", "public_id")
        },
        public_id="c" * 32,
    )
    db.add(two)
    install.next_poll_at = two.next_poll_at = NOW
    db.commit()
    seen = []
    monkeypatch.setattr(poller, "_poll", lambda d, i, n: seen.append(i.id))
    db.commit()
    poll_due(db, NOW)
    assert len(seen) == 1


def test_registered_in_loop():
    assert poller.poll_due in loop.STEPS


def test_apply_failure_reschedules_and_counts(db, install, svc, monkeypatch):
    svc.secret = _secret(install)
    n = {"i": 0}

    def bad(*a, **k):
        n["i"] += 1
        raise RuntimeError("boom")

    monkeypatch.setattr(poller, "apply_actions", bad)
    install.next_poll_at = NOW
    db.commit()
    poll_due(db, NOW)
    assert install.next_poll_at == NOW + timedelta(seconds=60)
    assert install.failures >= 1 and n["i"] == 1
    poll_due(db, NOW)
    assert n["i"] == 1


def test_poll_seconds_120_schedules_120(db, install, monkeypatch):
    from tests.integrations.int_helpers import DEMO, sign_env

    install.manifest = json.dumps(sign_env({**DEMO, "poll_seconds": 120}))
    assert load_manifest(json.loads(install.manifest)).poll_seconds == 120
    install.next_poll_at = NOW
    db.commit()
    poll_due(db, NOW)
    assert install.next_poll_at == NOW + timedelta(seconds=120)
