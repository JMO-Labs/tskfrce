"""Happy Hour edge cases: window end, undo, inactive kids, ledger text, team runs."""

from datetime import datetime, timedelta

import pytest
from app.models.inbox import Notification
from app.models.points import Points
from app.models.user import UserRole
from app.services import chore_actions, happy_hour

from tests.conftest import _make_user
from tests.factories import make_run
from tests.test_happy_hour import T0, _paid, _start


def test_submit_at_exactly_ends_at_pays_base(db, parent, kid):
    _start(db, parent)
    run = make_run(db, parent, kid, points=10)
    chore_actions.submit(run, kid.id, T0 + timedelta(minutes=60))
    chore_actions.approve(db, run, parent.id)
    db.commit()
    assert run.hh_mult_x10 is None and _paid(db, run) == [10]


def test_undo_then_done_without_happy_hour_pays_base(client, db, parent, kid, parent_headers):
    now = datetime.utcnow()
    _start(db, parent, now=now - timedelta(minutes=1))
    run = make_run(db, parent, kid, points=10)
    chore_actions.submit(run, kid.id, now)
    chore_actions.approve(db, run, parent.id)
    db.commit()
    assert _paid(db, run) == [20]
    for hh in happy_hour.running(db, datetime.utcnow()):
        happy_hour.stop(hh)
    db.commit()
    assert client.post(f"/api/v1/chores/{run.id}/undo", headers=parent_headers).status_code == 200
    assert client.post(f"/api/v1/chores/{run.id}/done", headers=parent_headers).status_code == 200
    assert _paid(db, run) == [10]


def test_start_ignores_ids_that_are_not_active_kids(db, parent, kid):
    gone = _make_user(db, "gone", UserRole.KID)
    gone.is_active = False
    db.commit()
    hh = _start(db, parent, kids=[kid.id, gone.id, parent.id, 9999])
    assert hh.kid_ids == [kid.id]
    assert db.query(Notification).filter_by(kind="happy_hour").count() == 1


@pytest.mark.parametrize("mult,label", [(15, "×1.5"), (20, "×2"), (30, "×3")])
def test_ledger_names_the_multiplier(db, parent, kid, mult, label):
    _start(db, parent, mult=mult)
    run = make_run(db, parent, kid, points=10, title="Dishes")
    chore_actions.submit(run, kid.id, T0 + timedelta(minutes=5))
    chore_actions.approve(db, run, parent.id)
    db.commit()
    row = db.query(Points).filter_by(run_id=run.id, reason="chore").one()
    assert row.description == f"Dishes (Happy Hour {label})"


def test_ledger_plain_without_happy_hour(db, parent, kid):
    run = make_run(db, parent, kid, points=10, title="Dishes")
    chore_actions.submit(run, kid.id, T0)
    chore_actions.approve(db, run, parent.id)
    db.commit()
    assert db.query(Points).filter_by(run_id=run.id, reason="chore").one().description == "Dishes"


def test_team_run_ignores_kid_scoped_happy_hour(db, parent, kid):
    ana = _make_user(db, "ana", UserRole.KID)
    _start(db, parent, kids=[kid.id])
    run = make_run(db, parent, kids=[kid, ana], points=10, mode="team")
    chore_actions.submit(run, kid.id, T0 + timedelta(minutes=5))
    chore_actions.approve(db, run, parent.id)
    db.commit()
    assert run.hh_mult_x10 is None and _paid(db, run) == [5, 5]


def test_team_run_all_kids_happy_hour_pays_both(db, parent, kid):
    ana = _make_user(db, "ana", UserRole.KID)
    _start(db, parent)
    run = make_run(db, parent, kids=[kid, ana], points=10, mode="team")
    chore_actions.submit(run, kid.id, T0 + timedelta(minutes=5))
    chore_actions.approve(db, run, parent.id)
    db.commit()
    assert _paid(db, run) == [10, 10]


def test_race_run_keeps_submitter_scope(db, parent, kid):
    ana = _make_user(db, "ana", UserRole.KID)
    _start(db, parent, kids=[kid.id])
    run = make_run(db, parent, kids=[kid, ana], points=10, mode="race")
    chore_actions.submit(run, kid.id, T0 + timedelta(minutes=5))
    assert run.hh_mult_x10 == 20


def test_start_with_no_active_kids_left_refuses(db, parent):
    with pytest.raises(ValueError):
        _start(db, parent, kids=[parent.id])
