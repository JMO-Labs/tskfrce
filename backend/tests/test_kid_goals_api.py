"""Kid goals API."""

from app.models.family import get_family
from app.models.goal import Goal, GoalParty
from app.models.points import Points, PointsType
from app.models.user import User, UserRole
from app.services import goals

U = "/api/v1/kid/goals"


def _fund(db, kid, n):
    db.add(Points(user_id=kid.id, points_type=PointsType.BONUS, amount=n, description="t"))
    db.commit()


def _goal(db, parent, kid=None, target=100, status="active", **kw):
    g = Goal(
        name=kw.pop("name", "Bike"),
        kid_id=kid.id if kid else None,
        target=target,
        status=status,
        created_by_id=parent.id,
        **kw,
    )
    db.add(g)
    db.commit()
    return g


def _sis(db):
    u = User(
        username="sis",
        email="s@family.local",
        hashed_password="x",
        full_name="Sis",
        role=UserRole.KID,
    )
    db.add(u)
    db.commit()
    return u


def _fam(db, **kw):
    fam = get_family(db)
    for k, v in kw.items():
        setattr(fam, k, v)
    db.commit()
    return fam


def test_suggest_off_403(client, db, kid, kid_headers):
    _fam(db, goal_suggest=False)
    r = client.post(f"{U}/suggest", json={"name": "Bike"}, headers=kid_headers)
    assert r.status_code == 403 and r.json()["detail"] == "A parent turned off goal ideas."


def test_suggest_ok_notifies(client, db, parent, kid, kid_headers):
    r = client.post(f"{U}/suggest", json={"name": "Bike"}, headers=kid_headers)
    assert r.status_code == 200
    j = r.json()
    assert j["status"] == "suggested" and j["target"] is None and j["kid_id"] == kid.id
    from app.models.inbox import Notification

    n = db.query(Notification).filter(Notification.kind == "goal_suggested").one()
    assert n.title == "Timmy suggests Bike"


def test_suggest_name_validation(client, kid_headers):
    assert client.post(f"{U}/suggest", json={"name": ""}, headers=kid_headers).status_code == 422
    assert (
        client.post(f"{U}/suggest", json={"name": "x" * 61}, headers=kid_headers).status_code == 422
    )


def test_suggest_limit_409_and_little(client, db, kid, kid_headers):
    kid.age_group = "little"
    db.commit()
    assert client.post(f"{U}/suggest", json={"name": "A"}, headers=kid_headers).status_code == 200
    r = client.post(f"{U}/suggest", json={"name": "B"}, headers=kid_headers)
    assert r.status_code == 409 and r.json()["detail"] == "You can have 1 goal at a time."


def test_start_screen_needs_banking(client, db, kid_headers):
    _fam(db, goal_screen_on=False)
    assert (
        client.post(f"{U}/start", json={"kind": "screen"}, headers=kid_headers).status_code == 400
    )
    _fam(db, goal_screen_on=True, points_unlock_early=False)
    assert (
        client.post(f"{U}/start", json={"kind": "screen"}, headers=kid_headers).status_code == 400
    )
    assert client.post(f"{U}/start", json={"kind": "jail"}, headers=kid_headers).status_code == 400


def test_start_screen_and_builtins(client, db, kid, kid_headers):
    _fam(
        db,
        goal_screen_on=True,
        points_unlock_early=True,
        screen_rollover=True,
        goal_screen_price=200,
        goal_screen_minutes=60,
    )
    j = client.get(U, headers=kid_headers).json()
    assert [b["kind"] for b in j["builtins"]] == ["screen"]
    assert j["builtins"][0]["target"] == 200 and j["builtins"][0]["minutes"] == 60
    r = client.post(f"{U}/start", json={"kind": "screen"}, headers=kid_headers)
    assert r.status_code == 200
    assert r.json()["target"] == 200 and r.json()["status"] == "active"
    assert r.json()["minutes"] == 60


def test_other_kids_goal_404(client, db, parent, kid, kid_headers):
    sis = _sis(db)
    g = _goal(db, parent, sis)
    _fund(db, kid, 50)
    for path in ("add", "withdraw"):
        r = client.post(f"{U}/{g.id}/{path}", json={"amount": 5}, headers=kid_headers)
        assert r.status_code == 404
    assert client.delete(f"{U}/{g.id}", headers=kid_headers).status_code == 404
    assert client.post(f"{U}/{g.id}/auto", headers=kid_headers).status_code == 404


def test_add_withdraw_delete_own(client, db, parent, kid, kid_headers):
    g = _goal(db, parent, kid)
    _fund(db, kid, 50)
    r = client.post(f"{U}/{g.id}/add", json={"amount": 30}, headers=kid_headers)
    assert r.status_code == 200 and r.json()["saved"] == 30 and r.json()["mine"] == 30
    r = client.post(f"{U}/{g.id}/withdraw", json={"amount": 10}, headers=kid_headers)
    assert r.json()["saved"] == 20
    assert (
        client.post(f"{U}/{g.id}/add", json={"amount": 0}, headers=kid_headers).status_code == 422
    )
    assert client.delete(f"{U}/{g.id}", headers=kid_headers).status_code == 204
    from app.services import economy

    assert economy.balance(db, kid.id) == 50


def test_delete_blocked_cases(client, db, parent, kid, kid_headers):
    _fund(db, kid, 50)
    g = _goal(db, parent, kid, target=20)
    client.post(f"{U}/{g.id}/add", json={"amount": 20}, headers=kid_headers)
    assert client.delete(f"{U}/{g.id}", headers=kid_headers).status_code == 409  # full
    g2 = _goal(db, parent, kid, target=100)
    client.post(f"{U}/{g2.id}/add", json={"amount": 10}, headers=kid_headers)
    _fam(db, goal_withdraw=False)
    assert client.delete(f"{U}/{g2.id}", headers=kid_headers).status_code == 409


def test_family_goal_rules(client, db, parent, kid, kid_headers):
    g = _goal(db, parent, None)
    _fund(db, kid, 50)
    assert (
        client.post(f"{U}/{g.id}/add", json={"amount": 10}, headers=kid_headers).status_code == 200
    )
    r = client.post(f"{U}/{g.id}/withdraw", json={"amount": 5}, headers=kid_headers)
    assert r.status_code == 409
    assert client.delete(f"{U}/{g.id}", headers=kid_headers).status_code == 409


def test_get_siblings_hidden_and_mine(client, db, parent, kid, kid_headers):
    sis = _sis(db)
    g = _goal(db, parent, None)
    _fund(db, kid, 50)
    _fund(db, sis, 50)
    goals.save(db, g, kid, 10)
    goals.save(db, g, sis, 7)
    j = client.get(U, headers=kid_headers).json()
    assert j["goals"][0]["siblings"] is None and j["goals"][0]["mine"] == 10
    _fam(db, goal_siblings=True)
    j = client.get(U, headers=kid_headers).json()
    assert {s["name"]: s["amount"] for s in j["goals"][0]["siblings"]} == {"Timmy": 10, "Sis": 7}


def test_get_shape_free_can_add(client, db, parent, kid, kid_headers):
    _fund(db, kid, 40)
    _goal(db, parent, kid)
    j = client.get(U, headers=kid_headers).json()
    assert j["on"] is True and j["free"] == 40 and j["can_add"] is True
    assert j["auto_goal_id"] is None and j["done"] == [] and j["party"] == []
    _goal(db, parent, kid)
    assert client.get(U, headers=kid_headers).json()["can_add"] is False


def test_auto_choose(client, db, parent, kid, kid_headers):
    g = _goal(db, parent, kid)
    assert client.post(f"{U}/{g.id}/auto", headers=kid_headers).status_code == 204
    assert client.get(U, headers=kid_headers).json()["auto_goal_id"] == g.id
    g2 = _goal(db, parent, kid, name="Other")
    client.post(f"{U}/{g2.id}/auto", headers=kid_headers)
    assert client.get(U, headers=kid_headers).json()["auto_goal_id"] == g2.id


def test_party_then_seen(client, db, parent, kid, kid_headers):
    g = _goal(db, parent, kid, status="fulfilled", fulfilled_by_id=parent.id)
    db.add(GoalParty(goal_id=g.id, kid_id=kid.id))
    db.commit()
    j = client.get(U, headers=kid_headers).json()
    assert j["party"] == [{"goal_id": g.id, "name": "Bike", "by": parent.full_name}]
    assert [d["id"] for d in j["done"]] == [g.id]
    assert client.post(f"{U}/{g.id}/party-seen", headers=kid_headers).status_code == 204
    assert client.get(U, headers=kid_headers).json()["party"] == []


def test_goals_off_empty(client, db, parent, kid, kid_headers):
    g = _goal(db, parent, kid, status="fulfilled", fulfilled_by_id=parent.id)
    db.add(GoalParty(goal_id=g.id, kid_id=kid.id))
    _goal(db, parent, kid)
    _fam(db, goals_on=False)
    j = client.get(U, headers=kid_headers).json()
    assert j["on"] is False
    assert j["goals"] == j["party"] == j["builtins"] == j["done"] == []


def test_goals_off_blocks_writes(client, db, parent, kid, kid_headers):
    g = _goal(db, parent, kid)
    _fund(db, kid, 50)
    _fam(db, goals_on=False)
    r = client.post(f"{U}/{g.id}/add", json={"amount": 10}, headers=kid_headers)
    assert r.status_code == 403


def test_preview_get_ok_post_403(client, db, parent, kid, parent_headers):
    h = {**parent_headers, "X-View-As": str(kid.id)}
    assert client.get(U, headers=h).status_code == 200
    assert client.post(f"{U}/suggest", json={"name": "x"}, headers=h).status_code == 403
