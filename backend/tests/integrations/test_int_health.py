from app.integrations import health
from app.integrations.client import ProtocolError
from app.integrations.health import guarded_call
from app.integrations.net import BlockedError, FetchError
from app.models.inbox import Notification
from tests.integrations.int_helpers import raising


def test_five_failures_pause_and_notify(db, install):
    for _ in range(5):
        assert guarded_call(db, install, raising(FetchError("timeout"))) is None
    assert install.status == "paused" and install.paused_reason == "timed out"
    assert db.query(Notification).filter_by(kind="integration_paused").count() >= 1


def test_notifies_once_and_paused_gets_no_calls(db, install):
    for _ in range(5):
        guarded_call(db, install, raising(ProtocolError("bad")))
    n = db.query(Notification).filter_by(kind="integration_paused").count()
    called = []
    guarded_call(db, install, lambda c: called.append(1))
    health.fail(db, install, "x")
    assert called == []
    assert db.query(Notification).filter_by(kind="integration_paused").count() == n


def test_success_resets_failures(db, install):
    guarded_call(db, install, raising(ProtocolError("bad")))
    assert install.failures == 1
    guarded_call(db, install, lambda c: "ok")
    assert install.failures == 0


def test_paused_install_is_not_called(db, install):
    install.status = "paused"
    called = []
    guarded_call(db, install, lambda c: called.append(1))
    assert called == []


def test_rate_limit_skips_without_failing(db, install, monkeypatch):
    monkeypatch.setattr(health, "OUTBOUND_PER_MIN", 1)
    assert guarded_call(db, install, lambda c: "a") == "a"
    assert guarded_call(db, install, lambda c: "b") is None and install.failures == 0


def test_rate_limit_is_per_install(db, install, monkeypatch):
    monkeypatch.setattr(health, "OUTBOUND_PER_MIN", 1)
    guarded_call(db, install, lambda c: "a")
    install.id += 1000
    assert guarded_call(db, install, lambda c: "b") == "b"


def test_reasons():
    r = health._reason
    assert r(BlockedError("x")) == "blocked address"
    assert r(ProtocolError("blocked")) == "blocked address"
    assert r(FetchError("status 500")) == "not reachable"
    assert r(ProtocolError("timeout")) == "timed out"
    assert r(ProtocolError("bad signature")) == "bad signature"
    assert r(ProtocolError("schema")) == "bad reply"
