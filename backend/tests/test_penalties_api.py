from app.models.family import get_family
from app.models.lock import Device, DeviceGroup
from app.models.points import Points, PointsType
from app.models.user import UserRole

from tests.conftest import _headers, _make_user

B = "/api/v1"


def _on(db):
    get_family(db).penalties_enabled = True
    db.commit()


def _pts(db, kid, n=50):
    db.add(Points(user_id=kid.id, points_type=PointsType.BONUS, amount=n, description="t"))
    db.commit()


def _give(client, headers, kid_ids, **kw):
    body = {"kid_ids": kid_ids, "kind": "points", "amount": 20, "earn_back": "all", **kw}
    return client.post(f"{B}/penalties", json=body, headers=headers)


def test_give_requires_enabled(client, db, kid, parent_headers):
    assert _give(client, parent_headers, [kid.id]).status_code == 409


def test_kid_cannot_give(client, db, kid, kid_headers):
    _on(db)
    assert _give(client, kid_headers, [kid.id]).status_code in (401, 403)


def test_give_and_list(client, db, kid, parent_headers):
    _on(db)
    _pts(db, kid)
    r = _give(client, parent_headers, [kid.id], reason="  rude  ")
    assert r.status_code == 201
    [p] = r.json()
    assert p["amount_taken"] == 20 and p["reason"] == "rude" and len(p["makeup"]) == 2
    rows = client.get(f"{B}/kids/{kid.id}/penalties", headers=parent_headers).json()
    assert [x["id"] for x in rows] == [p["id"]]
    assert _give(client, parent_headers, [999]).status_code == 404
    assert _give(client, parent_headers, [kid.id], amount=0).status_code == 422


def test_family_penalty_endpoint(client, db, kid, parent_headers):
    _on(db)
    k2 = _make_user(db, "kid2", UserRole.KID)
    r = _give(client, parent_headers, [kid.id, k2.id])
    assert len(r.json()) == 2
    r = _give(client, parent_headers, [kid.id, k2.id], device_id=1)
    assert r.status_code == 422


def test_options_recent_and_targets(client, db, kid, parent_headers):
    _on(db)
    d = Device(mac="aa:bb:cc:dd:ee:01", name="Switch", status="assigned")
    d.owners = [kid]
    g = DeviceGroup(name="Consoles")
    g.devices = [d]
    db.add_all([d, g])
    db.commit()
    _give(client, parent_headers, [kid.id])
    o = client.get(f"{B}/penalties/options", headers=parent_headers).json()
    assert o["enabled"] and set(o["sizes"]) == {"small", "medium", "big"}
    k = next(x for x in o["kids"] if x["id"] == kid.id)
    assert k["recent"] == 1
    assert k["devices"] == [{"id": d.id, "name": "Switch"}]
    assert k["groups"] == [{"id": g.id, "name": "Consoles"}]


def test_shorten_forgive_cancel_routes(client, db, kid, parent_headers):
    _on(db)
    [b] = _give(
        client, parent_headers, [kid.id], kind="block", amount=1440, earn_back="half"
    ).json()
    r = client.post(
        f"{B}/penalties/{b['id']}/shorten", json={"minutes": 60}, headers=parent_headers
    )
    assert r.status_code == 200 and r.json()["status"] == "active"
    r = client.post(f"{B}/penalties/{b['id']}/shorten", json={"minutes": 5}, headers=parent_headers)
    assert r.status_code == 422
    assert (
        client.post(f"{B}/penalties/{b['id']}/forgive", headers=parent_headers).json()["status"]
        == "forgiven"
    )
    for act in ("forgive", "cancel"):
        assert (
            client.post(f"{B}/penalties/{b['id']}/{act}", headers=parent_headers).status_code == 409
        )
    _pts(db, kid)
    [p] = _give(client, parent_headers, [kid.id], earn_back="none").json()
    assert p["status"] == "ended"
    s = client.post(
        f"{B}/penalties/{p['id']}/shorten", json={"minutes": 60}, headers=parent_headers
    )
    assert s.status_code == 409
    c = client.post(f"{B}/penalties/{p['id']}/cancel", headers=parent_headers)
    assert c.json()["status"] == "cancelled"
    assert client.post(f"{B}/penalties/999/cancel", headers=parent_headers).status_code == 404


def test_kid_today_shows_only_own_penalty(client, db, kid, kid_headers, parent_headers):
    _on(db)
    k2 = _make_user(db, "kid2", UserRole.KID)
    _give(client, parent_headers, [kid.id, k2.id])
    mine = client.get(f"{B}/kid/today", headers=kid_headers).json()["penalties"]
    assert len(mine) == 1 and mine[0]["kid_id"] == kid.id and "by_name" in mine[0]
    assert "chore_run_id" not in mine[0]


def test_kid_seen_hides_points_card(client, db, kid, kid_headers, parent_headers):
    _on(db)
    [p] = _give(client, parent_headers, [kid.id], earn_back="none").json()
    assert len(client.get(f"{B}/kid/today", headers=kid_headers).json()["penalties"]) == 1
    assert client.post(f"{B}/kid/penalties/{p['id']}/seen", headers=kid_headers).status_code == 204
    assert client.get(f"{B}/kid/today", headers=kid_headers).json()["penalties"] == []


def test_kid_cannot_mark_siblings_seen(client, db, kid, parent_headers):
    _on(db)
    k2 = _make_user(db, "kid2", UserRole.KID)
    [p] = _give(client, parent_headers, [k2.id], earn_back="none").json()
    r = client.post(f"{B}/kid/penalties/{p['id']}/seen", headers=_headers(db, kid))
    assert r.status_code == 404


def test_points_history_label_penalty(client, db, kid, parent_headers):
    _on(db)
    _pts(db, kid)
    _give(client, parent_headers, [kid.id])
    row = db.query(Points).filter_by(reason="penalty").one()
    row.description = None
    db.commit()
    rows = client.get(f"{B}/kids/{kid.id}/points", headers=parent_headers).json()
    assert "Penalty" in [r["label"] for r in (rows if isinstance(rows, list) else rows["rows"])]


def test_family_patch_penalty_settings(client, db, parent_headers):
    sizes = {
        "small": {"kind": "screen", "amount": 30, "earn_back": "half"},
        "medium": {"kind": "block", "amount": 120, "earn_back": "none"},
        "big": {"kind": "block", "amount": 2880, "earn_back": "all"},
    }
    r = client.patch(
        f"{B}/family",
        json={"penalties_enabled": True, "penalty_sizes": sizes, "makeup_chores": ["Dust"]},
        headers=parent_headers,
    )
    assert r.status_code == 200
    j = client.get(f"{B}/family", headers=parent_headers).json()
    assert j["penalties_enabled"] and j["penalty_sizes"] == sizes and j["makeup_chores"] == ["Dust"]
    bad = {**sizes, "small": {"kind": "nope", "amount": 1, "earn_back": "all"}}
    assert (
        client.patch(f"{B}/family", json={"penalty_sizes": bad}, headers=parent_headers).status_code
        == 422
    )
