"""Trust mode wired into the approval flow."""

from datetime import UTC, date, datetime

from app.models.chores import ChoreRun
from app.models.family import get_family
from app.models.inbox import Notification
from app.models.points import Points
from app.models.trust import TrustEvent
from app.services import chore_actions, happy_hour, trust
from app.services import chores as svc

from tests.factories import make_run

DAY = date(2026, 10, 20)
NOON = datetime(2026, 10, 20, 12, 0, tzinfo=UTC)
API = "/api/v1"


def _setup(monkeypatch, roll=0.99):
    class Fake(datetime):
        @classmethod
        def now(cls, tz=None):
            return NOON

    monkeypatch.setattr("app.api.kid.datetime", Fake)
    orig = trust.decide
    monkeypatch.setattr(trust, "decide", lambda db, run, ids: orig(db, run, ids, rng=lambda: roll))


def _kid(db, kid, on=True, level=2, clean=0):
    kid.trust_mode, kid.trust_level, kid.trust_clean = on, level, clean
    get_family(db).last_reset_date = DAY
    db.commit()


def _finish(client, kid_headers, run):
    return client.post(f"{API}/kid/chores/{run.id}/done", headers=kid_headers)


def _pts(db, run):
    return [p.amount for p in db.query(Points).filter_by(run_id=run.id, reason="chore")]


def _kinds(db, kind):
    return db.query(Notification).filter_by(kind=kind).count()


def test_off_kid_unchanged_and_notifies(client, db, parent, kid, kid_headers, monkeypatch):
    _setup(monkeypatch)
    _kid(db, kid, on=False)
    r = make_run(db, parent, kid)
    res = _finish(client, kid_headers, r)
    assert res.json()["status"] == "submitted_for_approval"
    assert r.status == "submitted" and not r.spot_check
    assert _kinds(db, "chore_submitted") == 1


def test_auto_pays_once_no_parent_alert(client, db, parent, kid, kid_headers, monkeypatch):
    _setup(monkeypatch)
    _kid(db, kid)
    r = make_run(db, parent, kid, points=10)
    assert _finish(client, kid_headers, r).json()["status"] == "done"
    assert r.status == "done" and r.approved_via == "trust" and r.approved_by_id is None
    assert _pts(db, r) == [10]
    assert _kinds(db, "chore_submitted") == 0
    db.refresh(kid)
    assert kid.trust_clean == 1


def test_auto_state_is_done_and_counts_toward_progress(db, parent, kid):
    _kid(db, kid)
    r = make_run(db, parent, kid)
    chore_actions.submit(r, kid.id, datetime(2026, 10, 20, 12))
    chore_actions.approve(db, r, None, via="trust")
    db.commit()
    assert svc.state(r) == "done"
    assert svc.counts(db, kid.id, DAY) == (1, 1)


def test_spot_waits_and_is_flagged(client, db, parent, kid, kid_headers, monkeypatch):
    _setup(monkeypatch, roll=0.0)
    _kid(db, kid)
    r = make_run(db, parent, kid)
    assert _finish(client, kid_headers, r).json()["status"] == "submitted_for_approval"
    assert r.status == "submitted" and r.spot_check
    assert _kinds(db, "chore_submitted") == 1


def test_always_check_waits_at_proven(client, db, parent, kid, kid_headers, monkeypatch):
    _setup(monkeypatch)
    _kid(db, kid)
    r = make_run(db, parent, kid)
    r.assignment.chore.always_check = True
    db.commit()
    assert _finish(client, kid_headers, r).json()["status"] == "submitted_for_approval"
    assert not r.spot_check


def test_parent_mark_done_not_rolled(client, db, parent, kid, parent_headers):
    _kid(db, kid, level=1, clean=3)
    r = make_run(db, parent, kid)
    assert client.post(f"{API}/chores/{r.id}/done", headers=parent_headers).status_code == 200
    db.refresh(r)
    assert r.approved_via == "parent" and r.approved_by_id == parent.id and not r.spot_check
    db.refresh(kid)
    assert kid.trust_clean == 4


def test_integration_not_rolled_or_counted(db, parent, kid):
    _kid(db, kid, level=1, clean=3)
    r = make_run(db, parent, kid)
    chore_actions.submit(r, kid.id, datetime(2026, 10, 20, 12))
    chore_actions.approve(db, r, None, via="integration")
    db.commit()
    assert r.approved_via == "integration" and svc.state(r) != "done"
    db.refresh(kid)
    assert kid.trust_clean == 3


def _submitted(db, parent, kid, spot):
    r = make_run(db, parent, kid, status="submitted", submitted_by=kid)
    r.spot_check = spot
    db.commit()
    return r


def test_send_back_spot_is_catch(client, db, parent, kid, parent_headers):
    _kid(db, kid, level=2, clean=7)
    r = _submitted(db, parent, kid, True)
    res = client.post(
        f"{API}/chores/{r.id}/send-back", json={"note": "redo"}, headers=parent_headers
    )
    assert res.status_code == 200
    db.refresh(kid)
    assert (kid.trust_level, kid.trust_clean) == (1, 0)
    assert not r.spot_check
    ev = db.query(TrustEvent).filter_by(kind="catch").one()
    assert ev.by_id == parent.id


def test_send_back_normal_is_not_catch(client, db, parent, kid, parent_headers):
    _kid(db, kid, level=2, clean=7)
    r = _submitted(db, parent, kid, False)
    client.post(f"{API}/chores/{r.id}/send-back", json={"note": "redo"}, headers=parent_headers)
    db.refresh(kid)
    assert (kid.trust_level, kid.trust_clean) == (2, 7)


def test_send_back_spot_team_only_submitter_drops(db, parent, kid):
    from app.models.user import UserRole

    from tests.conftest import _make_user

    sis = _make_user(db, "sis", UserRole.KID)
    for k in (kid, sis):
        k.trust_mode, k.trust_level, k.trust_clean = True, 2, 5
    r = make_run(db, parent, kids=[kid, sis], mode="team", status="submitted", submitted_by=kid)
    r.spot_check = True
    db.commit()
    chore_actions.send_back(db, r, "redo", parent.id)
    db.commit()
    assert (kid.trust_level, kid.trust_clean) == (1, 0)
    assert (sis.trust_level, sis.trust_clean) == (2, 0)


def test_trust_off_keeps_level_and_next_chore_waits(
    client, db, parent, kid, kid_headers, monkeypatch
):
    _setup(monkeypatch)
    _kid(db, kid, on=False, level=2)
    r = make_run(db, parent, kid)
    _finish(client, kid_headers, r)
    db.refresh(kid)
    assert kid.trust_level == 2 and r.status == "submitted"


def test_auto_keeps_happy_hour_multiplier(client, db, parent, kid, kid_headers, monkeypatch):
    _setup(monkeypatch)
    _kid(db, kid)
    happy_hour.start(
        db,
        kid_ids=None,
        minutes=60,
        mult_x10=20,
        source="parent",
        by=parent.id,
        now=NOON.replace(tzinfo=None),
    )
    db.commit()
    r = make_run(db, parent, kid, points=10)
    _finish(client, kid_headers, r)
    assert r.status == "done" and _pts(db, r) == [20]


def test_always_check_round_trips_in_library(client, db, parent_headers):
    r = client.post(
        f"{API}/chores/", json={"title": "Q", "always_check": True}, headers=parent_headers
    )
    assert r.json()["always_check"] is True
    cid = r.json()["id"]
    r = client.patch(f"{API}/chores/{cid}", json={"always_check": False}, headers=parent_headers)
    assert r.json()["always_check"] is False


def test_racing_finishes_pay_once(tmp_path):
    from app.core.database import Base
    from app.models.user import UserRole
    from app.services.chore_types import seed
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from tests.conftest import _make_user

    eng = create_engine(
        f"sqlite:///{tmp_path}/t.db", connect_args={"check_same_thread": False, "timeout": 5}
    )
    Base.metadata.create_all(eng)
    S = sessionmaker(bind=eng, autoflush=False)
    a = S()
    seed(a)
    a.commit()
    p = _make_user(a, "p", UserRole.PARENT)
    k1, k2 = _make_user(a, "k1", UserRole.KID), _make_user(a, "k2", UserRole.KID)
    for k in (k1, k2):
        k.trust_mode, k.trust_level = True, 2
    r = make_run(a, p, kids=[k1, k2], mode="race", points=10)
    rid, ids = r.id, (k1.id, k2.id)
    a.close()
    s1, s2 = S(), S()
    r1, r2 = s1.get(ChoreRun, rid), s2.get(ChoreRun, rid)
    assert r1.status == r2.status == "todo"  # both pass the status guard
    paid = 0
    for s, r, kid_id in ((s1, r1, ids[0]), (s2, r2, ids[1])):
        if chore_actions.claim(s, r):
            chore_actions.submit(r, kid_id, datetime(2026, 10, 20, 12))
            chore_actions.approve(s, r, None, via="trust")
            paid += 1
        s.commit()
    rows = S().query(Points).filter_by(run_id=rid, reason="chore").all()
    assert paid == 1 and len(rows) == 1


def test_redo_after_catch_waits_for_parent(
    client, db, parent, kid, kid_headers, parent_headers, monkeypatch
):
    _setup(monkeypatch, roll=0.99)  # would auto-approve without the catch
    _kid(db, kid, level=2)
    r = _submitted(db, parent, kid, True)
    client.post(f"{API}/chores/{r.id}/send-back", json={"note": "redo"}, headers=parent_headers)
    assert _finish(client, kid_headers, r).json()["status"] == "submitted_for_approval"
    assert r.status == "submitted"
