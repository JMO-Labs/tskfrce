import pytest
from app.models.family import get_family
from app.models.goal import Goal, GoalContribution
from app.models.user import UserRole

from tests.conftest import _make_user

U = "/api/v1/goals"


def _post(client, h, **kw):
    body = {"name": "Bike", "target": 100, "kid_ids": [], "family": False, **kw}
    return client.post(U, json=body, headers=h)


def _goal(db, parent, kid=None, status="active", target=100, **kw):
    g = Goal(
        name="G",
        kid_id=kid.id if kid else None,
        target=target,
        status=status,
        created_by_id=parent.id,
        **kw,
    )
    db.add(g)
    db.commit()
    return g


def _add(db, g, amount, kid=None):
    db.add(
        GoalContribution(goal_id=g.id, kid_id=kid.id if kid else None, amount=amount, kind="save")
    )
    db.commit()


def test_create_for_two_kids(client, db, parent, parent_headers, kid):
    k2 = _make_user(db, "sue", UserRole.KID)
    r = _post(client, parent_headers, kid_ids=[kid.id, k2.id], emoji="x")
    assert r.status_code == 200, r.text
    out = r.json()
    assert len(out) == 2 and {g["kid_id"] for g in out} == {kid.id, k2.id}
    assert out[0]["status"] == "active" and out[0]["family"] is False


def test_create_family(client, parent_headers):
    out = _post(client, parent_headers, family=True).json()
    assert len(out) == 1 and out[0]["family"] is True and out[0]["kid_id"] is None


def test_create_needs_kids_or_family(client, parent_headers):
    assert _post(client, parent_headers).status_code == 400


def test_builtin_off_400_on_uses_settings(client, db, parent_headers, kid):
    r = _post(client, parent_headers, kind="jail", kid_ids=[kid.id], target=1)
    assert r.status_code == 400
    fam = get_family(db)
    fam.goal_jail_on, fam.goal_jail_price = True, 321
    db.commit()
    out = _post(client, parent_headers, kind="jail", kid_ids=[kid.id], target=1).json()[0]
    assert out["target"] == 321 and out["name"] == "Get out of jail free"


def test_screen_builtin(client, db, parent_headers, kid):
    fam = get_family(db)
    fam.goal_screen_on, fam.goal_screen_minutes, fam.goal_screen_price = True, 45, 150
    db.commit()
    r = _post(client, parent_headers, kind="screen", kid_ids=[kid.id], target=1)
    assert r.status_code == 400  # banking not active
    fam.points_unlock_early = fam.screen_rollover = True
    db.commit()
    out = _post(client, parent_headers, kind="screen", kid_ids=[kid.id], target=1).json()[0]
    assert (out["name"], out["target"], out["minutes"]) == ("45 min extra screen time", 150, 45)


def test_family_must_be_custom(client, db, parent_headers):
    fam = get_family(db)
    fam.goal_jail_on = True
    db.commit()
    assert _post(client, parent_headers, kind="jail", family=True).status_code == 400


@pytest.mark.parametrize(
    "kw", [{"name": ""}, {"name": "x" * 61}, {"target": 0}, {"target": 100001}]
)
def test_create_validation(client, parent_headers, kw):
    assert _post(client, parent_headers, family=True, **kw).status_code == 422


def test_kid_403_everywhere(client, db, parent, kid, kid_headers):
    g = _goal(db, parent)
    calls = [
        ("get", U, None),
        ("post", U, {"name": "a", "target": 5, "kid_ids": [], "family": True}),
        ("patch", f"{U}/{g.id}", {"name": "b"}),
        ("delete", f"{U}/{g.id}", None),
        ("post", f"{U}/{g.id}/price", {"target": 5}),
        ("post", f"{U}/{g.id}/decline", None),
        ("post", f"{U}/{g.id}/fulfill", None),
        ("post", f"{U}/{g.id}/chip-in", {"amount": 5}),
        ("get", f"{U}/settings", None),
        ("patch", f"{U}/settings", {"on": False}),
    ]
    for m, url, body in calls:
        r = getattr(client, m)(url, headers=kid_headers, **({"json": body} if body else {}))
        assert r.status_code == 403, (m, url, r.status_code)


def test_price_suggestion(client, db, parent, parent_headers, kid):
    g = _goal(db, parent, kid, status="suggested", target=None)
    r = client.post(f"{U}/{g.id}/price", json={"target": 80}, headers=parent_headers)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "active" and r.json()["target"] == 80
    db.refresh(g)
    assert g.owner_id == parent.id


def test_price_non_suggestion_409(client, db, parent, parent_headers):
    g = _goal(db, parent)
    assert (
        client.post(f"{U}/{g.id}/price", json={"target": 8}, headers=parent_headers).status_code
        == 409
    )


def test_decline_deletes(client, db, parent, parent_headers, kid):
    g = _goal(db, parent, kid, status="suggested", target=None)
    gid = g.id
    assert client.post(f"{U}/{gid}/decline", headers=parent_headers).status_code == 204
    db.expire_all()
    assert db.get(Goal, gid) is None


def test_fulfill(client, db, parent_headers, parent, kid):
    g = _goal(db, parent, kid)
    assert client.post(f"{U}/{g.id}/fulfill", headers=parent_headers).status_code == 409
    g.status = "full"
    db.commit()
    r = client.post(f"{U}/{g.id}/fulfill", headers=parent_headers)
    assert r.status_code == 200 and r.json()["status"] == "fulfilled"


def test_chip_in(client, db, parent, parent_headers, kid):
    mine = _goal(db, parent, kid)
    r = client.post(f"{U}/{mine.id}/chip-in", json={"amount": 5}, headers=parent_headers)
    assert r.status_code == 400
    fam = _goal(db, parent)
    r = client.post(f"{U}/{fam.id}/chip-in", json={"amount": 5}, headers=parent_headers)
    assert r.status_code == 200 and r.json()["saved"] == 5
    r = client.post(f"{U}/{fam.id}/chip-in", json={"amount": 0}, headers=parent_headers)
    assert r.status_code == 422


def test_patch_target_below_saved_marks_full(client, db, parent, parent_headers, kid):
    g = _goal(db, parent, kid, target=100)
    _add(db, g, 60, kid)
    r = client.patch(f"{U}/{g.id}", json={"target": 50}, headers=parent_headers)
    assert r.status_code == 200
    assert r.json()["status"] == "full" and r.json()["saved"] == 60
    r = client.patch(f"{U}/{g.id}", json={"target": 200, "name": "New"}, headers=parent_headers)
    assert r.json()["status"] == "active" and r.json()["name"] == "New"


def test_delete_refunds_and_409_when_fulfilled(client, db, parent, parent_headers, kid):
    g = _goal(db, parent, kid, status="fulfilled")
    assert client.delete(f"{U}/{g.id}", headers=parent_headers).status_code == 409
    g2 = _goal(db, parent, kid)
    assert client.delete(f"{U}/{g2.id}", headers=parent_headers).status_code == 204


def test_list_groups(client, db, parent, parent_headers, kid):
    _goal(db, parent, kid, status="suggested", target=None)
    _goal(db, parent, kid, status="full")
    _goal(db, parent, kid)
    _goal(db, parent)
    _goal(db, parent, kid, status="fulfilled")
    d = client.get(U, headers=parent_headers).json()
    assert [len(d[k]) for k in ("waiting", "family", "kids", "done")] == [2, 1, 1, 1]
    assert d["settings"]["on"] is True


def test_settings_roundtrip(client, db, parent_headers):
    r = client.get(f"{U}/settings", headers=parent_headers)
    assert r.status_code == 200 and r.json()["auto_pct"] == 25 and r.json()["screen_ok"] is False
    r = client.patch(
        f"{U}/settings", json={"on": False, "auto_pct": 50, "max_teen": 5}, headers=parent_headers
    )
    assert r.json()["on"] is False and r.json()["auto_pct"] == 50
    fam = get_family(db)
    db.refresh(fam)
    assert fam.goals_on is False and fam.goal_max_teen == 5 and fam.goal_max_kid == 2


@pytest.mark.parametrize(
    "body",
    [
        {"auto_pct": 7},
        {"auto_pct": 4},
        {"auto_pct": 105},
        {"max_kid": 0},
        {"max_little": 11},
        {"screen_price": 0},
        {"jail_price": 100001},
        {"screen_minutes": 10},
        {"screen_minutes": 250},
        {"screen_minutes": 20},
    ],
)
def test_settings_validation(client, parent_headers, body):
    assert client.patch(f"{U}/settings", json=body, headers=parent_headers).status_code == 422


def test_viewer_fields(client, db, parent, parent_headers, kid):
    g = _goal(db, parent, kid)
    _add(db, g, 30, kid)
    out = client.get(U, headers=parent_headers).json()["kids"][0]
    assert out["mine"] == 0 and out["siblings"] == [{"name": "Timmy", "amount": 30}]


def test_today_needs_you(client, db, parent, parent_headers, kid):
    _goal(db, parent, kid, status="suggested", target=None)
    _goal(db, parent, status="full")
    r = client.get("/api/v1/today", headers=parent_headers)
    assert r.status_code == 200, r.text
    items = {n["type"]: n for n in r.json()["needs_you"]}
    assert items["goal_suggested"]["kid_id"] == kid.id
    assert items["goal_full"]["kid_id"] is None and items["goal_full"]["cost"] == 100
