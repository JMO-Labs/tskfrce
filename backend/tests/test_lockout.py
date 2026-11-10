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


def test_map_is_capped(clock):
    for i in range(20_000):
        lockout.fail(f"claim:{i}")
        assert len(lockout._state) <= lockout.MAX_KEYS


def test_locked_key_survives_sweep(clock):
    _fail("claim:a", 5)
    clock[0] += 61
    _fail("claim:a", 5)  # second lockout: 120 s
    _fail("claim:b", 1)
    clock[0] += 61  # claim:b's fail is stale, claim:a still locked
    lockout._sweep(clock[0])
    assert set(lockout._state) == {"claim:a"}
    assert _detail("claim:a") == "Too many tries. Wait 1 minute and try again."


def test_sweep_not_run_every_fail(clock, monkeypatch):
    calls = []
    real = lockout._sweep
    monkeypatch.setattr(lockout, "_sweep", lambda now: (calls.append(now), real(now)))
    for i in range(3 * lockout.SWEEP_ABOVE):
        lockout.fail(f"claim:{i}")
    assert 1 <= len(calls) <= 2


def test_cap_never_evicts_locked_key(clock):
    _fail("claim:a", 5)
    clock[0] += 1
    for i in range(lockout.MAX_KEYS + 1000):
        lockout.fail(f"claim:{i}")
    assert _detail("claim:a") == "Too many tries. Wait 1 minute and try again."
    assert len(lockout._state) <= lockout.MAX_KEYS
