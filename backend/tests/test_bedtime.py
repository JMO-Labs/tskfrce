"""Bedtime auto-approve: opt-in family switch that clears chores still waiting at a set time."""

from datetime import UTC, date, datetime, timedelta

import pytest
from app.models.chores import ChoreRun
from app.models.family import get_family
from app.models.inbox import Notification
from app.models.points import Points
from app.models.trust import TrustEvent
from app.services import bedtime, chore_actions, push
from app.services import chores as svc

from tests.factories import make_run
from tests.test_notify_core import _place

API = "/api/v1"
D = date(2026, 11, 4)
AT = datetime(2026, 11, 4, 21, 0, tzinfo=UTC)
SUB = datetime(2026, 11, 4, 12)


@pytest.fixture(autouse=True)
def _utc(db):
    fam = get_family(db)
    fam.timezone, fam.last_reset_date = "UTC", None
    db.commit()


def _on(db, at="21:00"):
    fam = get_family(db)
    fam.bedtime_auto, fam.bedtime_auto_at = True, at
    db.commit()


def _wait(db, parent, kid, n=1, **kw):
    return [
        make_run(db, parent, kid, status="submitted", submitted_at=SUB, title=f"w{i}", **kw)
        for i in range(n)
    ]


def _run(db, now=AT):
    n = bedtime.run(db, now)
    db.commit()
    return n


def _status(db, r):
    db.refresh(r)
    return r.status, r.approved_via


def _lines(db, parent):
    return [
        n.title for n in db.query(Notification).filter_by(user_id=parent.id, kind="bedtime_done")
    ]


def test_off_does_nothing(db, parent, kid):
    [r] = _wait(db, parent, kid)
    assert _run(db) == 0
    assert _status(db, r) == ("submitted", None)
    assert get_family(db).bedtime_date is None


def test_fires_once_at_time(db, parent, kid):
    _on(db)
    [a] = _wait(db, parent, kid)
    assert _run(db, AT - timedelta(minutes=1)) == 0
    assert _status(db, a) == ("submitted", None)
    assert _run(db) == 1
    assert _status(db, a) == ("done", "bedtime")
    assert get_family(db).bedtime_date == D
    [b] = _wait(db, parent, kid, day=D)
    assert _run(db, AT + timedelta(hours=1)) == 0  # same local day: already ran
    assert _status(db, b) == ("submitted", None)
    assert _run(db, AT + timedelta(days=1)) == 1  # next day
    assert _status(db, b) == ("done", "bedtime")


def test_late_tick_still_fires(db, parent, kid):
    _on(db)
    [a] = _wait(db, parent, kid)
    assert _run(db, AT + timedelta(hours=2)) == 1
    assert _status(db, a)[0] == "done"


def test_skips_spot_and_always_check(db, parent, kid):
    _on(db)
    [spot] = _wait(db, parent, kid)
    spot.spot_check = True
    [alw] = _wait(db, parent, kid)
    alw.assignment.chore.always_check = True
    [ok] = _wait(db, parent, kid)
    db.commit()
    assert _run(db) == 1
    assert _status(db, spot) == ("submitted", None)
    assert _status(db, alw) == ("submitted", None)
    assert _status(db, ok) == ("done", "bedtime")


def test_skips_redo_after_a_catch(db, parent, kid):
    _on(db)
    [redo] = _wait(db, parent, kid)
    db.add(TrustEvent(kid_id=kid.id, kind="catch", run_id=redo.id))
    db.commit()
    assert _run(db) == 0
    assert _status(db, redo) == ("submitted", None)


def test_clears_older_days_except_spot(db, parent, kid):
    _on(db)
    old, old_spot = _wait(db, parent, kid, n=2, day=D - timedelta(days=2))
    old_spot.spot_check = True
    db.commit()
    assert _run(db) == 1
    assert _status(db, old) == ("done", "bedtime")
    assert _status(db, old_spot) == ("submitted", None)


def test_counts_clean(db, parent, kid):
    _on(db)
    kid.trust_mode, kid.trust_level, kid.trust_clean = True, 1, 0
    db.commit()
    _wait(db, parent, kid, n=2)
    _run(db)
    db.refresh(kid)
    assert kid.trust_clean == 2


def test_take_back_works_on_bedtime_run(client, db, parent, kid, parent_headers):
    _on(db)
    [r] = _wait(db, parent, kid, points=10)
    _run(db)
    assert (
        client.post(f"{API}/chores/{r.id}/take-back", json={}, headers=parent_headers).status_code
        == 200
    )


def test_non_trust_kid_no_new_spot_checks(db, parent, kid, monkeypatch):
    _on(db)
    kid.trust_mode, kid.trust_level = True, 2
    db.commit()

    def boom(*a, **k):
        raise AssertionError("no spot-check roll at bedtime")

    monkeypatch.setattr("app.services.trust.decide", boom)
    rs = _wait(db, parent, kid, n=2)
    assert _run(db) == 2
    assert all(_status(db, r) == ("done", "bedtime") and not r.spot_check for r in rs)
    assert db.query(TrustEvent).count() == 0


def test_skipped_during_setup(db, parent, kid):
    _on(db)
    get_family(db).setup_step = 2
    db.commit()
    [r] = _wait(db, parent, kid)
    assert _run(db) == 0
    assert _status(db, r)[0] == "submitted"
    assert get_family(db).bedtime_date is None


def test_inbox_line_plural_and_none(db, parent, kid):
    _on(db)
    assert _run(db) == 0
    assert _lines(db, parent) == []
    _wait(db, parent, kid, n=3)
    _run(db, AT + timedelta(days=1))
    assert _lines(db, parent) == ["Bedtime approved 3 chores."]
    _wait(db, parent, kid)
    _run(db, AT + timedelta(days=2))
    assert _lines(db, parent)[-1] == "Bedtime approved 1 chore."


def test_no_push(db, parent, kid, pings, monkeypatch):
    _place(db, events=("chore_ok", "boost", "badge", "summary"))
    _on(db)
    monkeypatch.setattr(push, "enabled", lambda: True)
    kid.push_topic = "t"
    _wait(db, parent, kid)
    _run(db)
    assert _lines(db, parent) == ["Bedtime approved 1 chore."]
    assert not any("Bedtime" in p[1] for p in pings)
    assert not [m for m in db.info.get("push_out", []) if "Bedtime" in m["title"]]
    push.queue(db, kid.id, "bedtime_done", "Bedtime approved 1 chore.", None)
    assert not [m for m in db.info.get("push_out", []) if "Bedtime" in m["title"]]


def test_time_validation(client, db, parent_headers):
    def patch(**b):
        return client.patch(f"{API}/family", json=b, headers=parent_headers)

    for bad in ("17:45", "23:45", "21:10", "9:00", "xx"):
        assert patch(bedtime_auto_at=bad).status_code == 422, bad
    r = patch(bedtime_auto=True, bedtime_auto_at="22:15")
    assert r.status_code == 200 and r.json()["bedtime_auto_at"] == "22:15"
    assert client.get(f"{API}/family", headers=parent_headers).json()["bedtime_auto"] is True
    assert patch(bedtime_auto_at="18:00").status_code == 200
    assert patch(bedtime_auto_at="23:30").status_code == 200
    # a reset inside the range caps the latest time at 15 minutes before it
    assert patch(reset_time="22:00").status_code == 200
    assert patch(bedtime_auto_at="21:45").status_code == 200
    assert patch(bedtime_auto_at="22:00").status_code == 422
    assert patch(reset_time="22:00", bedtime_auto_at="21:30").status_code == 200


def test_tz_local_day(db, parent, kid):
    fam = get_family(db)
    fam.timezone = "America/Los_Angeles"
    db.commit()
    _on(db)
    [r] = _wait(db, parent, kid)
    assert _run(db, datetime(2026, 11, 5, 4, 30, tzinfo=UTC)) == 0  # 20:30 local
    assert _run(db, datetime(2026, 11, 5, 5, 30, tzinfo=UTC)) == 1  # 21:30 local on Nov 4
    assert get_family(db).bedtime_date == D
    assert _status(db, r)[0] == "done"


def test_parent_approved_mid_job_pays_once(db, parent, kid, monkeypatch):
    _on(db)
    a, b = _wait(db, parent, kid, n=2, points=5)
    orig = svc.waiting_runs

    def racing(d):
        rows = orig(d).all()
        chore_actions.approve(d, rows[0], parent.id)  # parent got there first
        return rows

    monkeypatch.setattr(svc, "waiting_runs", racing)
    assert _run(db) == 1
    paid = db.query(Points).filter(Points.run_id == a.id).count()
    assert paid == 1
    assert _status(db, a) == ("done", "parent")
    assert _status(db, b) == ("done", "bedtime")
    assert db.query(ChoreRun).filter_by(status="submitted").count() == 0


def test_recap_weekly_is_readable_and_settable(client, parent_headers):
    assert client.get(f"{API}/family", headers=parent_headers).json()["recap_weekly"] is True
    r = client.patch(f"{API}/family", json={"recap_weekly": False}, headers=parent_headers)
    assert r.json()["recap_weekly"] is False


@pytest.mark.parametrize("path,body", [("approve", {}), ("send-back", {"note": "again"})])
def test_parent_loses_race_to_bedtime(
    client, db, parent, kid, parent_headers, monkeypatch, path, body
):
    """Bedtime approves between the parent's check and write: parent gets 409, kid paid once."""
    from app.api import chores as api

    [r] = _wait(db, parent, kid, points=5)
    orig = api._waiting

    def late(d, rid):
        run = orig(d, rid)
        chore_actions.approve(d, run, None, via="bedtime")  # bedtime got there first
        d.commit()
        run.status = "submitted"  # the parent's request still holds the stale row
        return run

    monkeypatch.setattr(api, "_waiting", late)
    res = client.post(f"{API}/chores/{r.id}/{path}", json=body, headers=parent_headers)
    assert res.status_code == 409 and "already handled" in res.json()["detail"]
    db.expire_all()
    assert db.query(Points).filter(Points.run_id == r.id, Points.amount > 0).count() == 1
    assert _status(db, r) == ("done", "bedtime")
