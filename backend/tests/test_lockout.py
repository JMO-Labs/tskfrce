"""Growing lockout: 5 fails a minute, then 60 s doubling to 1 h; forgotten after 24 h."""

import pytest
from app.core import lockout
from fastapi import HTTPException


@pytest.fixture
def clock(monkeypatch):
    t = [1000.0]
    monkeypatch.setattr(lockout, "_now", lambda: t[0])
    return t


def _fail(key, n):
    for _ in range(n):
        lockout.fail(key)


def _detail(key):
    with pytest.raises(HTTPException) as e:
        lockout.check(key)
    assert e.value.status_code == 429
    return e.value.detail


def test_five_fails_lock_one_minute(clock):
    _fail("claim:a", 4)
    lockout.check("claim:a")
    lockout.fail("claim:a")
    assert _detail("claim:a") == "Too many tries. Wait 1 minute and try again."


def test_lockout_doubles(clock):
    _fail("claim:a", 5)
    clock[0] += 61
    lockout.check("claim:a")
    _fail("claim:a", 5)
    assert _detail("claim:a") == "Too many tries. Wait 2 minutes and try again."
    clock[0] += 119
    _detail("claim:a")
    clock[0] += 1
    lockout.check("claim:a")


def test_lockout_capped(clock):
    for _ in range(8):
        _fail("claim:a", 5)
        clock[0] += lockout.CAP
    _fail("claim:a", 5)
    assert _detail("claim:a") == "Too many tries. Wait 60 minutes and try again."
    clock[0] += lockout.CAP - 1
    _detail("claim:a")
    clock[0] += 1
    lockout.check("claim:a")


def test_strikes_forgotten_after_a_day(clock):
    _fail("claim:a", 5)
    clock[0] += 61
    _fail("claim:a", 5)  # second lockout: 120 s
    clock[0] += lockout.FORGET
    _fail("claim:a", 5)
    assert _detail("claim:a") == "Too many tries. Wait 1 minute and try again."


def test_fails_outside_window_do_not_count(clock):
    _fail("claim:a", 4)
    clock[0] += lockout.WINDOW
    lockout.fail("claim:a")
    lockout.check("claim:a")


def test_keys_independent(clock):
    _fail("claim:a", 5)
    _detail("claim:a")
    lockout.check("claim:b")


def test_reset_clears(clock):
    _fail("claim:a", 5)
    lockout.reset()
    lockout.check("claim:a")
