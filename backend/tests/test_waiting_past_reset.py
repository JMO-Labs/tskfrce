"""A submitted chore stays waiting across the reset until a parent answers."""

from datetime import datetime, timedelta

from app.lock.state import desired_blocked
from app.models.chores import ChoreRun
from app.models.family import get_family
from app.models.points import Points
from app.models.trust import TrustEvent
from app.models.user import UserRole
from app.services import chores as svc
from app.services import notify, notify_jobs

from tests.conftest import _make_user
from tests.factories import DAY, make_rule, make_run
from tests.lock.test_state import NOW, mk_device
from tests.test_notify_jobs import at

OLD = DAY - timedelta(days=1)
H = "/api/v1"


def _today(db, d=DAY):
    get_family(db).last_reset_date = d
    db.commit()


def test_reset_keeps_submitted_marks_todo_missed(db, parent, kid):
    waiting = make_run(db, parent, kid, status="submitted", day=OLD, title="W")
    todo = make_run(db, parent, kid, status="todo", day=OLD, title="T")
    svc.run_reset(db, DAY)
    db.commit()
    assert db.get(ChoreRun, waiting.id).status == "submitted"
    assert db.get(ChoreRun, todo.id).status == "missed"
    assert [r.id for r in svc.waiting_runs(db)] == [waiting.id]


def test_needs_lists_older_days_labelled(client, db, parent, kid, parent_headers):
    _today(db)
    old = make_run(db, parent, kid, status="submitted", day=OLD, title="Old")
    new = make_run(db, parent, kid, status="submitted", day=DAY, title="New")
    old.spot_check = True
    db.commit()
    j = client.get(f"{H}/today", headers=parent_headers).json()
    items = {n["id"]: n for n in j["needs_you"] if n["type"] in ("chore", "redo")}
    assert set(items) == {old.id, new.id}  # today's not duplicated
    assert items[old.id]["day"] == OLD.isoformat() and items[old.id]["spot_check"] is True
    assert items[new.id]["day"] == DAY.isoformat() and items[new.id]["spot_check"] is False
    (k,) = j["kids"]
    assert k["needs_you_count"] == 2
    assert [c["id"] for c in k["chores"]].count(new.id) == 1


def test_pending_count_includes_older(client, db, parent, kid, parent_headers):
    _today(db)
    make_run(db, parent, kid, status="submitted", day=OLD)
    make_run(db, parent, kid, status="submitted", day=DAY, title="n")
    assert client.get(f"{H}/today", headers=parent_headers).json()["pending_approvals"] == 2


def test_late_approval_keeps_multiplier_and_bonus(client, db, parent, kid, parent_headers):
    _today(db)
    fam = get_family(db)
    fam.early_bonus_cap = 10
    run = make_run(
        db, parent, kid, status="submitted", day=OLD, points=10, due_time="17:00",
        submitted_at=datetime(OLD.year, OLD.month, OLD.day, 8, 0), submitted_by=kid,
    )  # fmt: skip
    run.hh_mult_x10 = 20
    db.commit()
    assert client.post(f"{H}/chores/{run.id}/approve", headers=parent_headers).status_code == 200
    rows = {p.reason: p.amount for p in db.query(Points).filter(Points.run_id == run.id)}
    assert rows["chore"] == 20 and rows["early_bonus"] > 0


def test_old_waiting_does_not_gate_todays_lock(db, parent, kid):
    _today(db)
    mk_device(db, status="assigned", owners=[kid])
    make_rule(db, kid_ids=[kid.id])
    make_run(db, parent, kid, status="submitted", day=OLD)
    make_run(db, parent, kid, status="done", approved=True, day=DAY, title="t")
    assert desired_blocked(db, NOW) == []


def test_summary_counts_older_waiting(db, pings, parent, kid):
    from tests.test_notify_core import _place

    _place(db, events=tuple(notify.EVENTS))
    make_run(db, parent, kid, day=svc.today(db) - timedelta(days=2), status="submitted")
    notify_jobs.daily_summary(db, at(db, "19:00"))
    db.commit()
    assert "1 waiting for your OK" in pings[0][2]


def test_kid_delete_handles_older_waiting(client, db, parent, kid, parent_headers):
    other = _make_user(db, "maya", UserRole.KID)
    _today(db)
    run = make_run(db, parent, kids=[kid, other], status="submitted", day=OLD, mode="race")
    assert client.delete(f"{H}/kids/{kid.id}", headers=parent_headers).status_code == 200
    db.expire_all()
    assert db.get(ChoreRun, run.id).status == "submitted"  # still waits for the other kid


def test_reset_counts_days_with_waiting_chores(db, parent, kid):
    make_run(db, parent, kid, status="submitted", day=OLD)
    svc.run_reset(db, DAY)
    svc.run_reset(db, DAY + timedelta(days=1))
    assert get_family(db).waiting_reset_days == 2


def test_reset_without_waiting_chores_leaves_the_count(db, parent, kid):
    svc.run_reset(db, DAY)
    assert get_family(db).waiting_reset_days == 0


def test_reset_ignores_waiting_chores_bedtime_would_skip(db, parent, kid):
    spot = make_run(db, parent, kid, status="submitted", day=OLD, title="S")
    spot.spot_check = True
    always = make_run(db, parent, kid, status="submitted", day=OLD, title="A")
    always.assignment.chore.always_check = True
    db.commit()
    svc.run_reset(db, DAY)
    assert get_family(db).waiting_reset_days == 0


def test_reset_ignores_redo_after_a_catch(db, parent, kid):
    redo = make_run(db, parent, kid, status="submitted", day=OLD, title="R")
    db.add(TrustEvent(kid_id=kid.id, kind="catch", run_id=redo.id))
    db.commit()
    svc.run_reset(db, DAY)
    assert get_family(db).waiting_reset_days == 0


def test_reset_does_not_count_while_setup_is_open(db, parent, kid):
    make_run(db, parent, kid, status="submitted", day=OLD)
    get_family(db).setup_step = 5
    db.commit()
    svc.run_reset(db, DAY)
    assert get_family(db).waiting_reset_days == 0
