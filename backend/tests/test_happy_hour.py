from datetime import UTC, datetime, timedelta

import pytest
from app.models.family import get_family
from app.models.inbox import Notification
from app.models.points import Points
from app.models.user import UserRole
from app.services import chore_actions, happy_hour, inbox, push

from tests.conftest import _make_user
from tests.factories import make_run

T0 = datetime(2026, 10, 20, 16, 0)  # naive UTC


def _paid(db, run, reason="chore"):
    return sorted(p.amount for p in db.query(Points).filter_by(run_id=run.id, reason=reason))


def _start(db, parent, kids=None, mult=20, minutes=60, now=T0):
    hh = happy_hour.start(
        db, kid_ids=kids, minutes=minutes, mult_x10=mult, source="parent", by=parent.id, now=now
    )
    db.commit()
    return hh


def test_submitted_in_window_approved_later_pays_multiplier(db, parent, kid):
    """Review Focus 1: submitted 16:59 in a 16:00-17:00 Happy Hour, approved 19:00: x2."""
    _start(db, parent)
    run = make_run(db, parent, kid, points=10)
    chore_actions.submit(run, kid.id, T0 + timedelta(minutes=59))
    db.commit()
    assert run.hh_mult_x10 == 20
    assert happy_hour.active_for(db, kid.id, T0 + timedelta(hours=3)) is None
    chore_actions.approve(db, run, parent.id)
    db.commit()
    assert _paid(db, run) == [20]


def test_sent_back_then_resubmitted_after_end_pays_base(db, parent, kid):
    """Review Focus 2: sent back during a Happy Hour, resubmitted after it ends: x1."""
    _start(db, parent)
    run = make_run(db, parent, kid, points=10)
    chore_actions.submit(run, kid.id, T0 + timedelta(minutes=10))
    assert run.hh_mult_x10 == 20
    chore_actions.send_back(db, run, "redo")
    assert run.hh_mult_x10 is None
    chore_actions.submit(run, kid.id, T0 + timedelta(minutes=61))
    assert run.hh_mult_x10 is None
    chore_actions.approve(db, run, parent.id)
    db.commit()
    assert _paid(db, run) == [10]


def test_multiplier_on_base_only_early_bonus_unchanged(db, parent, kid):
    fam = get_family(db)
    fam.timezone, fam.early_bonus_cap = "UTC", 5
    db.commit()
    _start(db, parent, mult=15)
    run = make_run(db, parent, kid, points=3, due_time="20:00")
    chore_actions.submit(run, kid.id, T0 + timedelta(minutes=5))  # >=60 min early
    chore_actions.approve(db, run, parent.id)
    db.commit()
    assert _paid(db, run) == [4]  # floor(3 * 1.5)
    assert _paid(db, run, "early_bonus") == [5]


def test_shared_run_without_submitter_needs_all_kids_happy_hour(db, parent, kid):
    ana = _make_user(db, "ana", UserRole.KID)
    _start(db, parent, kids=[kid.id])
    run = make_run(db, parent, kids=[kid, ana], points=10, mode="team")
    chore_actions.submit(run, None, T0 + timedelta(minutes=5))
    assert run.hh_mult_x10 is None
    _start(db, parent, mult=30)
    run2 = make_run(db, parent, kids=[kid, ana], points=10, mode="team", title="y")
    chore_actions.submit(run2, None, T0 + timedelta(minutes=5))
    assert run2.hh_mult_x10 == 30
    chore_actions.approve(db, run2, parent.id)
    db.commit()
    assert _paid(db, run2) == [15, 15]  # (10 // 2) * 3 each


def test_kid_ids_scoping(db, parent, kid):
    ana = _make_user(db, "ana", UserRole.KID)
    _start(db, parent, kids=[ana.id])
    at = T0 + timedelta(minutes=1)
    assert happy_hour.active_for(db, kid.id, at) is None
    assert happy_hour.active_for(db, ana.id, at).mult_x10 == 20
    assert happy_hour.active_for(db, None, at) is None
    run = make_run(db, parent, kid, points=10)
    chore_actions.submit(run, kid.id, at)
    assert run.hh_mult_x10 is None
    assert happy_hour.active_for(db, ana.id, T0 - timedelta(minutes=1)) is None


def test_start_alerts_each_covered_kid_once(db, parent, kid):
    ana = _make_user(db, "ana", UserRole.KID)
    _make_user(db, "ben", UserRole.KID)
    _start(db, parent, kids=[kid.id, ana.id])
    rows = db.query(Notification).filter_by(kind="happy_hour").all()
    assert sorted(r.user_id for r in rows) == sorted([kid.id, ana.id])
    assert all(r.title == "Happy Hour started!" for r in rows)
    _start(db, parent)  # all kids
    assert db.query(Notification).filter_by(kind="happy_hour").count() == 5


def test_happy_hour_is_a_kid_push_kind():
    assert "happy_hour" in inbox.KID_KINDS
    assert push.GENERIC["happy_hour"] == "Happy Hour started!"


def test_start_rejects_odd_values(db, parent):
    with pytest.raises(ValueError):
        happy_hour.start(db, kid_ids=None, minutes=45, mult_x10=20, source="parent", by=parent.id)
    with pytest.raises(ValueError):
        happy_hour.start(db, kid_ids=None, minutes=60, mult_x10=25, source="parent", by=parent.id)


# --- parent API ---


def test_api_start_uses_family_defaults_then_stop(client, db, kid, parent_headers):
    r = client.post("/api/v1/happy-hour", json={}, headers=parent_headers)
    assert r.status_code == 200, r.text
    hh = r.json()
    assert hh["multiplier"] == 2 and hh["kid_ids"] is None and hh["source"] == "parent"
    now = datetime.now(UTC).replace(tzinfo=None)
    assert happy_hour.active_for(db, kid.id, now) is not None
    got = client.get("/api/v1/happy-hour", headers=parent_headers).json()
    assert [h["id"] for h in got["active"]] == [hh["id"]]
    assert [h["id"] for h in got["recent"]] == [hh["id"]]
    r = client.post(f"/api/v1/happy-hour/{hh['id']}/stop", headers=parent_headers)
    assert r.status_code == 200, r.text
    db.expire_all()
    assert happy_hour.active_for(db, kid.id, datetime.now(UTC).replace(tzinfo=None)) is None
    assert client.get("/api/v1/happy-hour", headers=parent_headers).json()["active"] == []


def test_api_start_validates(client, kid, parent_headers):
    url = "/api/v1/happy-hour"
    assert client.post(url, json={"mult_x10": 25}, headers=parent_headers).status_code == 422
    assert client.post(url, json={"minutes": 45}, headers=parent_headers).status_code == 422
    assert client.post(url, json={"kid_ids": [9999]}, headers=parent_headers).status_code == 422
    r = client.post(
        url, json={"kid_ids": [kid.id], "mult_x10": 30, "minutes": 90}, headers=parent_headers
    )
    assert r.json()["multiplier"] == 3 and r.json()["kid_ids"] == [kid.id]


def test_api_parent_only(client, db, parent, kid_headers):
    hh = _start(db, parent)
    assert client.post("/api/v1/happy-hour", json={}, headers=kid_headers).status_code == 403
    assert client.post(f"/api/v1/happy-hour/{hh.id}/stop", headers=kid_headers).status_code == 403
    assert client.get("/api/v1/happy-hour", headers=kid_headers).status_code == 403


def test_family_settings_expose_happy_hour_defaults(client, parent_headers):
    fam = client.get("/api/v1/family", headers=parent_headers).json()
    assert fam["hh_default_mult_x10"] == 20 and fam["hh_default_minutes"] == 60
    assert fam["hh_weekly_surprise"] is False and fam["hh_auto_boost"] is True
    body = {"hh_default_mult_x10": 30, "hh_default_minutes": 30, "hh_auto_boost": False}
    fam = client.patch("/api/v1/family", json=body, headers=parent_headers).json()
    assert fam["hh_default_mult_x10"] == 30 and fam["hh_auto_boost"] is False
    bad = client.patch("/api/v1/family", json={"hh_default_minutes": 45}, headers=parent_headers)
    assert bad.status_code == 422


# --- kid today ---


def test_kid_today_shows_happy_hour_and_points_now(client, db, parent, kid, kid_headers):
    from app.services import chores as svc

    today = svc.today(db, datetime.now(UTC))
    make_run(db, parent, kid, points=7, day=today)
    r = client.get("/api/v1/kid/today", headers=kid_headers).json()
    assert r["happy_hour"] is None
    assert r["chores"][0]["points_now"] == 7
    now = datetime.now(UTC).replace(tzinfo=None)
    _start(db, parent, kids=[kid.id], mult=15, now=now - timedelta(minutes=1))
    r = client.get("/api/v1/kid/today", headers=kid_headers).json()
    assert r["happy_hour"]["multiplier"] == 1.5
    assert r["happy_hour"]["ends_at"].endswith("Z")
    assert r["chores"][0]["points"] == 7 and r["chores"][0]["points_now"] == 10
