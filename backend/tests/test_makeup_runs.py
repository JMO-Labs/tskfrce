"""Make-up chore runs (linked to a penalty) stay out of daily counting."""

from datetime import timedelta

from app.models import Points
from app.models.chores import ChoreRun
from app.models.penalty import Penalty
from app.services import chore_actions, chores, progression

from tests.factories import DAY, make_chore


def _makeup(db, parent, kid, day=DAY):
    p = Penalty(kid_id=kid.id, kind="points", amount=10, earn_back="none")
    db.add(p)
    db.commit()
    c, a = make_chore(db, parent, "Sweep", 0, [kid], repeat="once", on_date=day)
    c.makeup = True
    r = ChoreRun(assignment=a, day=day, kid_id=kid.id, penalty_id=p.id)
    db.add(r)
    db.commit()
    return c, r


def test_makeup_run_not_in_counts(db, parent, kid):
    _makeup(db, parent, kid)
    assert chores.counts(db, kid.id, DAY) == (0, 0)


def test_makeup_run_rolls_forward_on_reset(db, parent, kid):
    _, r = _makeup(db, parent, kid)
    _, a = make_chore(db, parent, "Norm", 5, [kid], repeat="once", on_date=DAY)
    n = ChoreRun(assignment=a, day=DAY, kid_id=kid.id)
    db.add(n)
    db.commit()
    today = DAY + timedelta(days=2)
    chores.run_reset(db, today)
    db.commit()
    db.refresh(r)
    db.refresh(n)
    assert (r.status, r.day) == ("todo", today)
    assert n.status == "missed"


def test_makeup_run_pays_nothing(db, parent, kid):
    _, r = _makeup(db, parent, kid)
    assert chore_actions.approve(db, r, parent.id) == 0
    db.commit()
    assert db.query(Points).filter(Points.run_id == r.id, Points.amount > 0).count() == 0


def test_makeup_not_in_streak_days(db, parent, kid):
    _makeup(db, parent, kid)
    assert DAY not in progression.chore_days_many(db, [kid.id], DAY).get(kid.id, {})


def test_makeup_chore_hidden_from_library(db, client, parent, kid, parent_headers):
    c, _ = _makeup(db, parent, kid)
    ids = [x["id"] for x in client.get("/api/v1/chores/", headers=parent_headers).json()]
    assert c.id not in ids
