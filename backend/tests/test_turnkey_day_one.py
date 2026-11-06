"""Day one: nothing pauses a device during setup; chores start at the next reset after Finish."""

from datetime import UTC, date, datetime

import pytest
from app.api import setup as setup_api
from app.core.config import settings
from app.lock.state import desired_blocked, tick
from app.models.chores import ChoreRun
from app.models.family import get_family
from app.models.inbox import Notification

T = {"X-Internal-Token": settings.INTERNAL_TOKEN}
MAC = "aa:bb:cc:dd:ee:51"
LA = "America/Los_Angeles"


@pytest.fixture
def clock(monkeypatch):
    """The wall clock setup reads; tests move it."""
    now = {"t": datetime(2026, 11, 6, 18, 0, tzinfo=UTC)}
    monkeypatch.setattr(setup_api, "_now", lambda: now["t"])
    return now


def _claim(client, tz="UTC"):
    body = {
        "family_name": "F",
        "timezone": tz,
        "parent": {"username": "mom", "password": "pw-123456", "full_name": "Mom"},
    }
    r = client.post("/api/v1/setup", json=body)
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _step(client, ph, step):
    assert client.put("/api/v1/setup/step", json={"step": step}, headers=ph).status_code == 200


def _chores_and_device(client, ph):
    """Steps 3 to 6: a kid, a daily chore, then the kid's device (chore lock stays on)."""
    kid = client.post("/api/v1/kids", json={"full_name": "Tim"}, headers=ph).json()
    _step(client, ph, 5)
    c = client.post("/api/v1/chores/", json={"title": "Bed"}, headers=ph).json()
    a = {"kid_ids": [kid["id"]], "mode": "each", "repeat": {"type": "daily", "days": []}}
    r = client.post(f"/api/v1/chores/{c['id']}/assignments", json=a, headers=ph)
    assert r.status_code == 200, r.text
    return kid


def _device(client, ph, kid):
    dev = client.post("/api/v1/internal/devices/seen", json={"mac": MAC}, headers=T).json()
    r = client.patch(f"/api/v1/devices/{dev['id']}", json={"owner_ids": [kid["id"]]}, headers=ph)
    assert r.status_code == 200, r.text


def test_reset_during_setup_pauses_nothing(client, db, clock):
    ph = _claim(client)  # 18:00 UTC; reset 06:00 UTC
    kid = _chores_and_device(client, ph)
    _step(client, ph, 6)
    next_morning = datetime(2026, 11, 7, 6, 30, tzinfo=UTC)
    tick(db, next_morning)  # the reset passes while the wizard is open
    _device(client, ph, kid)
    assert db.query(ChoreRun).count() == 0
    assert desired_blocked(db, next_morning) == []
    assert get_family(db).last_reset_date == date(2026, 11, 7)  # the day still rolls over
    clock["t"] = next_morning.replace(hour=9)
    _step(client, ph, None)
    tick(db, next_morning.replace(hour=9))
    assert db.query(ChoreRun).count() == 0  # finish waits for the next reset
    after = datetime(2026, 11, 8, 6, 30, tzinfo=UTC)
    tick(db, after)
    assert [r.day for r in db.query(ChoreRun)] == [date(2026, 11, 8)]
    assert desired_blocked(db, after) == [MAC]


def test_no_kid_new_chore_alert_during_setup(client, db, clock):
    ph = _claim(client)
    _chores_and_device(client, ph)
    assert db.query(Notification).filter_by(kind="chore_new").count() == 0


def test_pacific_late_night_claim_starts_next_local_reset(client, db, clock):
    t0 = datetime(2026, 11, 7, 6, 30, tzinfo=UTC)  # 22:30 Nov 6 in Los Angeles
    tick(db, t0)  # the unclaimed box ran its loop in UTC
    assert get_family(db).last_reset_date == date(2026, 11, 7)
    clock["t"] = t0
    ph = _claim(client, LA)
    assert get_family(db).last_reset_date == date(2026, 11, 6)  # the chore day in Los Angeles
    kid = _chores_and_device(client, ph)
    _device(client, ph, kid)
    _step(client, ph, None)
    tick(db, datetime(2026, 11, 7, 13, 0, tzinfo=UTC))  # 05:00 PT: before the reset
    assert db.query(ChoreRun).count() == 0
    tick(db, datetime(2026, 11, 7, 14, 30, tzinfo=UTC))  # 06:30 PT Nov 7
    assert [r.day for r in db.query(ChoreRun)] == [date(2026, 11, 7)]


def test_finish_after_midnight_starts_at_next_reset(client, db, clock):
    """Finish at 02:00, reset 06:00: chores start at 06:00 (the finish copy says 'next daily reset')."""
    clock["t"] = datetime(2026, 11, 7, 2, 0, tzinfo=UTC)
    ph = _claim(client)
    kid = _chores_and_device(client, ph)
    _device(client, ph, kid)
    _step(client, ph, None)
    assert get_family(db).last_reset_date == date(2026, 11, 6)
    tick(db, datetime(2026, 11, 7, 2, 5, tzinfo=UTC))
    assert db.query(ChoreRun).count() == 0
    tick(db, datetime(2026, 11, 7, 6, 0, tzinfo=UTC))
    assert [r.day for r in db.query(ChoreRun)] == [date(2026, 11, 7)]


def test_finish_after_reset_time_waits_for_tomorrow(client, db, clock):
    """No loop tick before Finish: the first tick must not start chores the same evening."""
    ph = _claim(client)  # 18:00 UTC, reset 06:00
    get_family(db).last_reset_date = None
    db.commit()
    kid = _chores_and_device(client, ph)
    _device(client, ph, kid)
    _step(client, ph, None)
    tick(db, datetime(2026, 11, 6, 18, 5, tzinfo=UTC))
    assert db.query(ChoreRun).count() == 0
    assert desired_blocked(db, datetime(2026, 11, 6, 18, 5, tzinfo=UTC)) == []
    tick(db, datetime(2026, 11, 7, 6, 0, tzinfo=UTC))
    assert [r.day for r in db.query(ChoreRun)] == [date(2026, 11, 7)]


def test_finishing_again_keeps_the_chore_day(client, db, clock, parent_headers):
    """Saving 'no step' on a finished family must not skip a reset the loop has yet to run."""
    get_family(db).last_reset_date = date(2026, 11, 6)
    db.commit()
    clock["t"] = datetime(2026, 11, 7, 9, 0, tzinfo=UTC)  # past 06:00, loop not ticked yet
    _step(client, parent_headers, None)
    assert get_family(db).last_reset_date == date(2026, 11, 6)
