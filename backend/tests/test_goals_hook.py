"""Penalties hook: take points from a family goal, or raise its target."""

from app.models.family import get_family
from app.models.goal import Goal, GoalContribution

B = "/api/v1"


def _on(db):
    get_family(db).penalties_enabled = True
    db.commit()


def _fam_goal(db, parent, saved=100, target=300, status="active", kid=None):
    g = Goal(
        name="Trip",
        kid_id=kid.id if kid else None,
        target=target,
        status=status,
        created_by_id=parent.id,
    )
    db.add(g)
    db.flush()
    if saved:
        db.add(GoalContribution(goal_id=g.id, by_id=parent.id, amount=saved, kind="chip_in"))
    db.commit()
    return g


def _post(client, headers, **kw):
    body = {"goal_id": 1, "mode": "take", "amount": 40, **kw}
    return client.post(f"{B}/penalties/goal", json=body, headers=headers)


def test_take_records_reason(client, db, parent, parent_headers):
    _on(db)
    g = _fam_goal(db, parent)
    r = _post(client, parent_headers, goal_id=g.id, reason="  fighting ")
    assert r.status_code == 200 and r.json()["saved"] == 60
    c = db.query(GoalContribution).filter_by(kind="take").one()
    assert c.amount == -40 and c.note == "fighting" and c.by_id == parent.id and c.kid_id is None


def test_take_never_below_zero(client, db, parent, parent_headers):
    _on(db)
    g = _fam_goal(db, parent, saved=30)
    r = _post(client, parent_headers, goal_id=g.id, amount=500)
    assert r.json()["saved"] == 0
    assert db.query(GoalContribution).filter_by(kind="take").one().amount == -30
    assert _post(client, parent_headers, goal_id=g.id).status_code == 409  # nothing left


def test_take_from_full_goal_reopens(client, db, parent, parent_headers):
    _on(db)
    g = _fam_goal(db, parent, saved=300, status="full")
    r = _post(client, parent_headers, goal_id=g.id)
    assert r.json()["status"] == "active"


def test_raise_target_reopens_full(client, db, parent, parent_headers):
    _on(db)
    g = _fam_goal(db, parent, saved=300, status="full")
    r = _post(client, parent_headers, goal_id=g.id, mode="raise", amount=100)
    j = r.json()
    assert j["target"] == 400 and j["status"] == "active"


def test_only_family_live_goals(client, db, parent, kid, parent_headers):
    _on(db)
    mine = _fam_goal(db, parent, kid=kid)
    done = _fam_goal(db, parent, status="fulfilled")
    sug = _fam_goal(db, parent, status="suggested", saved=0)
    for g in (mine, done, sug):
        assert _post(client, parent_headers, goal_id=g.id).status_code == 409
    assert _post(client, parent_headers, goal_id=999).status_code == 404


def test_needs_penalties_on_and_parent(client, db, parent, parent_headers, kid_headers):
    g = _fam_goal(db, parent)
    assert _post(client, parent_headers, goal_id=g.id).status_code == 409
    _on(db)
    assert _post(client, kid_headers, goal_id=g.id).status_code in (401, 403)
    assert _post(client, parent_headers, goal_id=g.id, amount=0).status_code == 422


def test_options_list_family_goals(client, db, parent, kid, parent_headers):
    _on(db)
    g = _fam_goal(db, parent)
    _fam_goal(db, parent, kid=kid)
    _fam_goal(db, parent, status="fulfilled")
    j = client.get(f"{B}/penalties/options", headers=parent_headers).json()
    assert j["goals"] == [{"id": g.id, "name": "Trip", "saved": 100, "target": 300}]
    get_family(db).goals_on = False
    db.commit()
    assert client.get(f"{B}/penalties/options", headers=parent_headers).json()["goals"] == []
