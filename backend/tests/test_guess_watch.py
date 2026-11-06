import pytest
from app.models.inbox import Notification
from app.services import guess_watch


@pytest.fixture(autouse=True)
def _clean():
    guess_watch.reset()
    yield
    guess_watch.reset()


@pytest.fixture
def clock(monkeypatch):
    t = [1000.0]
    monkeypatch.setattr(guess_watch.time, "monotonic", lambda: t[0])
    return t


def _bad(client, name="mom", n=1):
    from app.core import ratelimit

    for _ in range(n):
        ratelimit.reset()
        r = client.post("/api/v1/auth/login", json={"username": name, "password": "wrong"})
        assert r.status_code == 401


def _alerts(db):
    return db.query(Notification).filter(Notification.kind == "password_guess").all()


def test_five_failures_alert(client, db, parent, clock):
    _bad(client, n=5)
    rows = _alerts(db)
    assert {r.title for r in rows} == {"Someone is guessing Mom's password"}
    assert {r.body for r in rows} == {
        "5 wrong passwords in 15 minutes. If it wasn't you, change it in Settings."
    }


def test_four_failures_no_alert(client, db, parent, clock):
    _bad(client, n=4)
    assert not _alerts(db)


def test_window_expires(client, db, parent, clock):
    _bad(client, n=4)
    clock[0] += 901
    _bad(client)
    assert not _alerts(db)


def test_cooldown(client, db, parent, clock):
    _bad(client, n=10)
    n1 = len(_alerts(db))
    assert n1 >= 1
    clock[0] += 3601
    _bad(client, n=5)
    assert len(_alerts(db)) == 2 * n1


def test_unknown_username_not_counted(client, db, parent, clock):
    _bad(client, "nobody", n=20)
    assert not _alerts(db)
    assert not guess_watch._fails


def test_kid_account_never_alerts(client, db, kid, parent, clock):
    _bad(client, "timmy", n=8)
    assert not _alerts(db)


def test_email_login_counts(client, db, parent, clock):
    _bad(client, "MOM@family.local", n=5)
    assert len(_alerts(db)) >= 1
