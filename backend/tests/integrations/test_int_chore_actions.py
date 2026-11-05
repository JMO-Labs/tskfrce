from datetime import datetime

from app.services import chore_actions
from app.services.economy import balance
from tests.factories import make_run

NOW = datetime(2026, 10, 20, 12, 0)


def test_approve_awards_points_without_parent(db, parent, kid):
    run = make_run(db, parent, kid, status="submitted", points=7)
    pts = chore_actions.approve(db, run, by_id=None)
    db.commit()
    assert pts >= 7 and run.status == "done" and run.approved_by_id is None
    assert balance(db, kid.id) == pts


def test_tick_all_then_submit(db, parent, kid):
    run = make_run(db, parent, kid, steps=("a", "b"))
    chore_actions.tick_all(run, kid.id, NOW)
    chore_actions.submit(run, kid.id, NOW)
    assert {t.done_by_id for t in run.ticks} == {kid.id} and len(run.ticks) == 2
    assert run.status == "submitted" and run.submitted_by_id == kid.id


def test_send_back_bumps_attempt(db, parent, kid):
    run = make_run(db, parent, kid, status="submitted", submitted_by=kid)
    chore_actions.send_back(db, run, "Try again")
    assert run.status == "todo" and run.attempt == 2 and run.last_note == "Try again"


def test_mark_done_leaves_submitted_by_empty(client, parent_headers, db, parent, kid):
    run = make_run(db, parent, kid)
    client.post(f"/api/v1/chores/{run.id}/done", headers=parent_headers)
    db.refresh(run)
    assert run.status == "done" and run.submitted_by_id is None
