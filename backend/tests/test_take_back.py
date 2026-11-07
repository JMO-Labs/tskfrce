"""Wasn't done: take back a chore that approved itself, plus trust settings API."""

from datetime import datetime, timedelta

from app.models.badge import BadgeAward
from app.models.chore_extra import ChorePhoto
from app.models.inbox import Notification
from app.models.points import Points, PointsType
from app.models.trust import TrustEvent
from app.models.user import UserRole
from app.services import chore_actions, economy
from app.services import chores as svc

from tests.conftest import _make_user
from tests.factories import make_run

API = "/api/v1"
SUB = datetime(2026, 10, 20, 12)


def _row(db, kid, amount, run=None, reason="chore", ptype=PointsType.TASK_COMPLETION):
    db.add(
        Points(
            user_id=kid.id,
            points_type=ptype,
            amount=amount,
            reason=reason,
            run_id=run.id if run else None,
        )
    )
    db.commit()


def _auto(db, parent, kid, via="trust", **kw):
    """A run that approved itself, paying through the normal path."""
    r = make_run(db, parent, kid, **kw)
    chore_actions.submit(r, kid.id, SUB)
    chore_actions.approve(db, r, None, via=via)
    db.commit()
    return r


def _take(client, ph, run, **body):
    return client.post(f"{API}/chores/{run.id}/take-back", json=body, headers=ph)


def _trust(db, kid, on=True, level=2, clean=5):
    kid.trust_mode, kid.trust_level, kid.trust_clean = on, level, clean
    db.commit()


def test_take_back_removes_multiplied_and_bonus_rows(client, db, parent, kid, parent_headers):
    r = _auto(db, parent, kid, points=10)
    _row(db, kid, 4, r, "early_bonus")
    _row(db, kid, 3, r, "chore")  # multiplied part
    assert _take(client, parent_headers, r).status_code == 200
    assert economy.balance(db, kid.id) == 0
    assert db.query(Points).filter(Points.run_id == r.id).count() == 0


def test_stops_at_zero_when_spent(client, db, parent, kid, parent_headers):
    _row(db, kid, 5, reason="bonus", ptype=PointsType.BONUS)
    r = _auto(db, parent, kid, points=10)
    _row(db, kid, -10, reason="redemption", ptype=PointsType.REDEMPTION)
    assert economy.balance(db, kid.id) == 5
    _take(client, parent_headers, r)
    assert economy.balance(db, kid.id) == 0
    fix = db.query(Points).filter(Points.reason == "adjustment").one()
    assert fix.amount == 5 and "below zero" in fix.description and fix.run_id is None
    assert fix.seen_by_kid is True  # no bonus celebration
    assert fix.points_type == PointsType.TRANSFER  # no XP or weekly score
    from app.services import progression

    assert progression.xp(db, kid.id) == 5  # only the 5 bonus; the correction adds no XP


def test_older_debt_not_forgiven(client, db, parent, kid, parent_headers):
    _row(db, kid, -3, reason="deduction", ptype=PointsType.PENALTY)
    r = _auto(db, parent, kid, points=10)
    _row(db, kid, -10, reason="redemption", ptype=PointsType.REDEMPTION)
    assert economy.balance(db, kid.id) == -3
    _take(client, parent_headers, r)
    assert economy.balance(db, kid.id) == -3


def test_enough_balance_no_correction(client, db, parent, kid, parent_headers):
    _row(db, kid, 20, reason="bonus", ptype=PointsType.BONUS)
    r = _auto(db, parent, kid, points=10)
    _take(client, parent_headers, r)
    assert economy.balance(db, kid.id) == 20
    assert db.query(Points).filter(Points.reason == "adjustment").count() == 0


def test_second_tap_409(client, db, parent, kid, parent_headers):
    r = _auto(db, parent, kid, points=10)
    _row(db, kid, 20, reason="bonus", ptype=PointsType.BONUS)
    assert _take(client, parent_headers, r).status_code == 200
    assert _take(client, parent_headers, r).status_code == 409
    assert economy.balance(db, kid.id) == 20


def test_parent_approved_run_409(client, db, parent, kid, parent_headers):
    r = make_run(db, parent, kid, status="submitted", submitted_at=SUB, submitted_by=kid)
    chore_actions.approve(db, r, parent.id)
    db.commit()
    assert _take(client, parent_headers, r).status_code == 409
    assert _take(client, parent_headers, make_run(db, parent, kid, title="y")).status_code == 409


def test_today_returns_to_todo_rerolls_on_resubmit(client, db, parent, kid, parent_headers):
    r = _auto(db, parent, kid, day=svc.today(db), mode="each")
    r.spot_check, r.hh_mult_x10 = True, 20
    db.commit()
    assert _take(client, parent_headers, r).status_code == 200
    db.refresh(r)
    assert r.status == "todo" and not r.spot_check and r.hh_mult_x10 is None
    assert r.approved_via is None and r.approved_at is None and r.approved_by_id is None
    assert r.submitted_at is None and r.submitted_by_id is None and r.completed_at is None
    assert not r.ticks
    chore_actions.submit(r, kid.id, SUB)  # fresh submit works, multiplier recomputed
    assert r.status == "submitted"


def test_older_day_cancels(client, db, parent, kid, parent_headers):
    r = _auto(db, parent, kid)
    assert _take(client, parent_headers, r).status_code == 200
    db.refresh(r)
    assert r.status == "cancelled"


def test_badges_stay(client, db, parent, kid, parent_headers):
    r = _auto(db, parent, kid)
    db.add(BadgeAward(kid_id=kid.id, badge_key="first", tier=1))
    db.commit()
    n = db.query(BadgeAward).count()
    _take(client, parent_headers, r)
    assert db.query(BadgeAward).count() == n


def test_kid_told_gently_and_level_drops(client, db, parent, kid, parent_headers):
    _trust(db, kid, level=2)
    r = _auto(db, parent, kid, title="Clean room", day=svc.today(db))
    _take(client, parent_headers, r)
    db.refresh(kid)
    assert (kid.trust_level, kid.trust_clean) == (1, 0)
    n = db.query(Notification).filter_by(user_id=kid.id, kind="chore_sent_back").one()
    assert n.title == "A parent checked Clean room and it needs another go."
    assert {(e.kind, e.by_id) for e in db.query(TrustEvent)} == {
        ("catch", parent.id),
        ("down", parent.id),
    }


def test_lower_false_keeps_level(client, db, parent, kid, parent_headers):
    _trust(db, kid, level=2)
    r = _auto(db, parent, kid)
    _take(client, parent_headers, r, lower_trust=False)
    db.refresh(kid)
    assert (kid.trust_level, kid.trust_clean) == (2, 0)
    assert [e.kind for e in db.query(TrustEvent)] == ["catch"]


def test_trust_off_kid_untouched(client, db, parent, kid, parent_headers):
    _trust(db, kid, on=False, level=2, clean=7)
    r = _auto(db, parent, kid)
    _take(client, parent_headers, r)
    db.refresh(kid)
    assert (kid.trust_level, kid.trust_clean) == (2, 7)
    assert db.query(TrustEvent).count() == 0


def test_team_all_lose_only_submitter_drops(client, db, parent, kid, parent_headers):
    other = _make_user(db, "sis", UserRole.KID)
    third = _make_user(db, "bro", UserRole.KID)
    _trust(db, kid, level=2)
    _trust(db, other, level=2)
    _trust(db, third, on=False, level=2, clean=4)
    r = make_run(db, parent, kids=[kid, other, third], mode="team", points=30, day=svc.today(db))
    chore_actions.submit(r, kid.id, SUB)
    chore_actions.approve(db, r, None, via="trust")
    db.commit()
    assert _take(client, parent_headers, r).status_code == 200
    for k in (kid, other, third):
        db.refresh(k)
        assert economy.balance(db, k.id) == 0
        assert db.query(Notification).filter_by(user_id=k.id, kind="chore_sent_back").count() == 1
    assert (kid.trust_level, other.trust_level, third.trust_level) == (1, 2, 2)
    assert (other.trust_clean, third.trust_clean) == (0, 4)


def test_team_nobody_submitted_everyone_drops(client, db, parent, kid, parent_headers):
    other = _make_user(db, "sis", UserRole.KID)
    _trust(db, kid, level=2)
    _trust(db, other, level=1)
    r = make_run(db, parent, kids=[kid, other], mode="team", points=20)
    chore_actions.approve(db, r, None, via="bedtime")  # approved without anyone submitting
    db.commit()
    _take(client, parent_headers, r)
    db.refresh(kid)
    db.refresh(other)
    assert (kid.trust_level, other.trust_level) == (1, 0)


def test_take_back_parent_only(client, db, parent, kid, kid_headers):
    r = _auto(db, parent, kid)
    assert _take(client, kid_headers, r).status_code == 403


def test_self_approved_window_7_days(client, db, parent, kid, parent_headers):
    now = datetime.utcnow()
    new = _auto(db, parent, kid, title="new", day=svc.today(db))
    old = _auto(db, parent, kid, title="old", via="bedtime")
    old.approved_at = now - timedelta(days=8)
    mid = _auto(db, parent, kid, title="mid", via="bedtime")
    mid.approved_at = now - timedelta(days=3)
    by_parent = make_run(db, parent, kid, status="submitted", submitted_at=SUB, title="p")
    chore_actions.approve(db, by_parent, parent.id)
    db.add(ChorePhoto(run_id=mid.id, uploaded_by_id=kid.id, path="a", thumb_path="b"))
    db.commit()
    res = client.get(f"{API}/kids/{kid.id}/self-approved", headers=parent_headers)
    assert res.status_code == 200
    got = res.json()
    assert [g["id"] for g in got] == [new.id, mid.id]
    assert got[1]["points"] == 3 and got[1]["photos"] == 1 and got[0]["photos"] == 0
    assert got[1]["title"] == "mid" and got[1]["approved_via"] == "bedtime"


def test_patch_trust_parent_only(client, db, parent, kid, parent_headers, kid_headers):
    url = f"{API}/kids/{kid.id}"
    assert client.patch(url, json={"trust_mode": True}, headers=kid_headers).status_code == 403
    res = client.patch(url, json={"trust_mode": True, "trust_level": 2}, headers=parent_headers)
    assert res.status_code == 200
    out = res.json()
    assert (out["trust_mode"], out["trust_level"], out["trust_clean"]) == (True, 2, 0)
    assert (
        client.get(url.replace(f"/{kid.id}", ""), headers=parent_headers).json()[0]["trust_level"]
        == 2
    )


def test_patch_trust_level_validated_and_same_is_noop(client, db, parent, kid, parent_headers):
    url = f"{API}/kids/{kid.id}"
    for bad in (-1, 3):
        assert (
            client.patch(url, json={"trust_level": bad}, headers=parent_headers).status_code == 422
        )
    _trust(db, kid, level=1, clean=4)
    client.patch(url, json={"trust_level": 1}, headers=parent_headers)
    db.refresh(kid)
    assert kid.trust_clean == 4 and db.query(TrustEvent).count() == 0
    client.patch(url, json={"trust_level": 0}, headers=parent_headers)
    db.refresh(kid)
    assert (kid.trust_level, kid.trust_clean) == (0, 0)
    assert [e.kind for e in db.query(TrustEvent)] == ["down"]
    assert db.query(Notification).filter_by(user_id=kid.id).count() == 0


def test_kid_today_trust_block(client, db, parent, kid, kid_headers):
    get = lambda: client.get(f"{API}/kid/today", headers=kid_headers).json()["trust"]  # noqa: E731
    assert get() is None
    _trust(db, kid, level=0, clean=4)
    assert get() == {"level": 0, "to_next": 6, "goal": 10}
    _trust(db, kid, level=1, clean=5)
    assert get() == {"level": 1, "to_next": 25, "goal": 30}
    _trust(db, kid, level=2, clean=5)
    assert get() == {"level": 2, "to_next": None, "goal": None}
    _trust(db, kid, on=False, level=2)
    assert get() is None


def test_attempt_bumped_old_photo_no_longer_counts(client, db, parent, kid, parent_headers):
    r = _auto(db, parent, kid, day=svc.today(db), needs_photo=True)
    db.add(ChorePhoto(run_id=r.id, uploaded_by_id=kid.id, path="a", thumb_path="b", attempt=1))
    db.commit()
    out = _take(client, parent_headers, r).json()
    db.refresh(r)
    assert r.attempt == 2 and svc.photo_count(r) == 0
    assert out["sent_back"] is True


def test_older_day_message_and_chat_copy(client, db, parent, kid, parent_headers):
    r = _auto(db, parent, kid, title="Dishes")
    _take(client, parent_headers, r)
    n = db.query(Notification).filter_by(user_id=kid.id, kind="chore_sent_back").one()
    assert n.title == "A parent checked Dishes and took its points back."
    from app.models.chat import ThreadMessage

    assert any(
        m.body == "A parent checked this one again · points taken back"
        for m in db.query(ThreadMessage)
    )


def test_failure_midway_leaves_run_and_ledger_unchanged(
    client, db, parent, kid, parent_headers, monkeypatch
):
    import pytest
    from app.services import trust

    _trust(db, kid, level=2)
    r = _auto(db, parent, kid, day=svc.today(db), points=10)
    before = [(p.id, p.amount) for p in db.query(Points).order_by(Points.id)]

    def boom(*a, **k):
        raise RuntimeError("boom")

    monkeypatch.setattr(trust, "catch_run", boom)
    with pytest.raises(RuntimeError):
        _take(client, parent_headers, r)
    db.expire_all()
    assert (r.status, r.approved_via, r.attempt) == ("done", "trust", 1)
    assert [(p.id, p.amount) for p in db.query(Points).order_by(Points.id)] == before
    monkeypatch.undo()
    assert _take(client, parent_headers, r).status_code == 200  # retry works, not 409


def test_kid_payload_trust_goal_and_today_approved_via(client, db, parent, kid, parent_headers):
    for level, goal in ((0, 10), (1, 30), (2, None)):
        _trust(db, kid, level=level)
        ks = client.get(f"{API}/kids", headers=parent_headers).json()
        assert next(k for k in ks if k["id"] == kid.id)["trust_goal"] == goal
    _auto(db, parent, kid, day=svc.today(db), title="Own")
    kids = client.get(f"{API}/today", headers=parent_headers).json()["kids"]
    chores = next(k for k in kids if k["id"] == kid.id)["chores"]
    assert [c["approved_via"] for c in chores if c["title"] == "Own"] == ["trust"]
