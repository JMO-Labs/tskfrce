"""Screen-time scope (all / other / group), approval rules and the opt-in group pricing flag."""

import pytest
from app.models.family import get_family
from app.models.lock import DeviceGroup, Override
from app.models.points import Points
from app.models.reward import Redemption
from app.services import economy, screen_time
from fastapi import HTTPException

from tests.test_screen_price import _dev, _grp, _req, _setup, _setup_prices

S = "/api/v1/screen-time"
R = "/api/v1/kid/redeem"


def _bonus(db):
    return {o.device_id for o in db.query(Override).filter_by(source="bonus")}


def _charged(db, kid):
    return [p.amount for p in db.query(Points).filter_by(user_id=kid.id, reason="redemption")]


def _manual(db):
    get_family(db).screen_auto_approve = False
    db.commit()


def _auto(db):
    get_family(db).screen_auto_approve = True
    db.commit()


# ---- approval (C) ----


def test_family_price_raised_no_groups_unlocks_all(db, kid, parent):
    _setup_prices(db, kid)
    d1, d2 = _dev(db, kid, 1), _dev(db, kid, 2)
    _manual(db)
    red = _req(db, kid)
    assert red.screen_scope == "all"
    get_family(db).screen_time_price = 30
    db.commit()
    economy.decide(db, red, parent, True)
    assert _charged(db, kid) == [-40]
    assert _bonus(db) == {d1.id, d2.id}


def test_group_price_raised_while_pending_still_unlocks(db, kid, parent):
    c, dt, dc = _setup(db, kid, parent)
    red = _req(db, kid, c.id)
    c.screen_price = 100
    db.commit()
    economy.decide(db, red, parent, True)
    assert _charged(db, kid) == [-80]
    assert _bonus(db) == {dc.id}


def test_device_moved_out_409_no_charge(db, kid, parent):
    c, dt, dc = _setup(db, kid, parent)
    red = _req(db, kid, c.id)
    dc.groups.remove(c)
    db.commit()
    with pytest.raises(HTTPException) as e:
        economy.decide(db, red, parent, True)
    assert e.value.status_code == 409
    assert e.value.detail == (
        f"None of those devices belong to {kid.full_name} anymore. "
        "Deny the request to give the points back."
    )
    db.rollback()
    assert _charged(db, kid) == []
    assert _bonus(db) == set()
    assert db.get(Redemption, red.id).status == "pending"


def test_group_gone_409_no_charge(db, kid, parent):
    c, dt, dc = _setup(db, kid, parent)
    red = _req(db, kid, c.id)
    db.delete(db.get(DeviceGroup, c.id))
    db.commit()
    with pytest.raises(HTTPException) as e:
        economy.decide(db, red, parent, True)
    assert e.value.status_code == 409
    db.rollback()
    assert _charged(db, kid) == [] and _bonus(db) == set()


def test_delete_group_denies_pending(client, db, kid, parent, parent_headers):
    c, dt, dc = _setup(db, kid, parent)
    red = _req(db, kid, c.id)
    other = _req(db, kid)
    before = economy.balance(db, kid.id)
    assert client.delete(f"/api/v1/groups/{c.id}", headers=parent_headers).status_code == 200
    db.expire_all()
    assert db.get(Redemption, red.id).status == "denied"
    assert db.get(Redemption, red.id).decided_at is not None
    assert db.get(Redemption, other.id).status == "pending"
    assert economy.balance(db, kid.id) == before
    assert economy.pending_cost(db, kid.id) == other.cost


def test_shared_device_stays_locked(db, kid, parent):
    t, c = _grp(db, "Tablets"), _grp(db, "Consoles", 40)
    only_t, shared = _dev(db, kid, 1, [t]), _dev(db, kid, 2, [t, c])
    _setup_prices(db, kid)
    economy.decide(db, _req(db, kid, t.id), parent, True)
    assert _bonus(db) == {only_t.id}


# ---- Other devices (B) ----


def test_other_option(db, kid, parent):
    _setup_prices(db, kid)
    c = _grp(db, "Consoles", 40)
    dc, tab = _dev(db, kid, 1, [c]), _dev(db, kid, 2)
    opts = screen_time.options(db, get_family(db), kid)
    assert [(o["scope"], o["name"], o["price"]) for o in opts] == [
        ("all", "All my devices", 40),
        ("other", "Other devices", 20),
        ("group", "Consoles", 40),
    ]
    assert opts[1]["group_id"] is None and opts[1]["icon"] == "devices"
    _auto(db)
    red = _req(db, kid, scope="other")
    assert (red.cost, red.screen_scope, red.device_group_id) == (40, "other", None)
    assert _bonus(db) == {tab.id}
    assert dc.id not in _bonus(db)


def test_no_other_when_all_is_family_price(db, kid):
    _setup_prices(db, kid)
    t = _grp(db, "Tablets", 10)
    _dev(db, kid, 1, [t])
    _dev(db, kid, 2)
    scopes = [o["scope"] for o in screen_time.options(db, get_family(db), kid)]
    assert scopes == ["all", "group"]


def test_free_only_device_not_priced_but_unlocked_by_all(db, kid, parent):
    _setup_prices(db, kid)
    get_family(db).screen_time_price = 50
    db.commit()
    free = _dev(db, kid, 1, [_grp(db, "Speakers", chore_lock=False)])
    tab = _dev(db, kid, 2, [_grp(db, "Tablets", 10)])
    opts = screen_time.options(db, get_family(db), kid)
    assert [(o["scope"], o["price"]) for o in opts] == [("all", 10)]
    _auto(db)
    _req(db, kid)
    assert _bonus(db) == {free.id, tab.id}


def test_other_scope_without_ungrouped_400(db, kid, parent):
    _setup(db, kid, parent)
    with pytest.raises(HTTPException) as e:
        _req(db, kid, scope="other")
    assert (e.value.status_code, e.value.detail) == (400, "Pick one of your options.")


def test_group_scope_without_id_400(db, kid, parent):
    _setup(db, kid, parent)
    with pytest.raises(HTTPException) as e:
        _req(db, kid, scope="group")
    assert e.value.status_code == 400
    assert db.query(Redemption).count() == 0


# ---- opt-in flag (I) ----


def test_group_pricing_off_by_default(db, kid):
    fam = get_family(db)
    assert fam.group_pricing is False
    fam.screen_time_price, fam.points_unlock_early = 20, True
    db.commit()
    c = _grp(db, "Consoles", 40)
    _dev(db, kid, 1, [c])
    _dev(db, kid, 2)
    assert screen_time.options(db, fam, kid) == [
        {"group_id": None, "scope": "all", "name": "All my devices", "icon": "devices", "price": 20}
    ]
    for gid, scope in ((c.id, None), (c.id, "group"), (None, "other")):
        with pytest.raises(HTTPException) as e:
            screen_time.price_for(db, fam, kid, scope or "group", gid)
        assert e.value.status_code == 400
    assert c.screen_price == 40  # kept for when it's turned back on


def test_pending_group_request_approves_after_flag_off(db, kid, parent):
    c, dt, dc = _setup(db, kid, parent)
    red = _req(db, kid, c.id)
    get_family(db).group_pricing = False
    db.commit()
    economy.decide(db, red, parent, True)
    assert _charged(db, kid) == [-80] and _bonus(db) == {dc.id}


def test_group_pricing_toggle_api(client, db, kid, kid_headers, parent_headers):
    assert client.get(S, headers=parent_headers).json()["group_pricing"] is False
    c = _grp(db, "Consoles", 40)
    _dev(db, kid, 1, [c])
    _dev(db, kid, 2)  # ungrouped, so Consoles doesn't collapse into All
    _setup_prices(db, kid)
    get_family(db).group_pricing = False
    db.commit()
    body = {"kind": "screen_time", "minutes": 30, "group_id": c.id}
    r = client.post(R, headers=kid_headers, json=body)
    assert r.status_code == 400
    assert client.patch(S, headers=parent_headers, json={"group_pricing": True}).json()[
        "group_pricing"
    ]
    assert client.post(R, headers=kid_headers, json=body).json()["cost"] == 80


# ---- HTTP (A, D) ----


def test_http_scope_and_bad_group(client, db, kid, kid_headers, parent_headers):
    g = client.post(
        "/api/v1/groups", json={"name": "Consoles", "screen_price": 40}, headers=parent_headers
    ).json()
    assert g["screen_price"] == 40
    _dev(db, kid, 1, [db.get(DeviceGroup, g["id"])])
    _dev(db, kid, 2)
    _setup_prices(db, kid)
    bad = {"kind": "screen_time", "minutes": 15, "scope": "group", "group_id": 9999}
    assert client.post(R, headers=kid_headers, json=bad).status_code == 400
    body = {"kind": "screen_time", "minutes": 15, "scope": "other"}
    assert client.post(R, headers=kid_headers, json=body).json()["cost"] == 20
    old = {"kind": "screen_time", "minutes": 15, "group_id": g["id"]}  # old client: no scope
    assert client.post(R, headers=kid_headers, json=old).json()["cost"] == 40


def test_kid_rewards_price_is_all_price(client, db, kid, kid_headers, parent):
    _setup(db, kid, parent)
    out = client.get("/api/v1/kid/rewards", headers=kid_headers).json()
    assert out["screen"]["price"] == 40 == out["screen_time_price"]
    assert out["screen"]["options"][0]["price"] == 40


def test_group_with_no_unlockable_device_not_offered(db, kid, parent):
    _setup_prices(db, kid)
    t, c = _grp(db, "Tablets"), _grp(db, "Consoles", 40)
    _dev(db, kid, 1, [t, c])  # its device_price is 40, above Tablets' 20
    _dev(db, kid, 2)
    opts = screen_time.options(db, get_family(db), kid)
    assert [(o["scope"], o["group_id"], o["price"]) for o in opts] == [
        ("all", None, 40),
        ("other", None, 20),
        ("group", c.id, 40),
    ]
    with pytest.raises(HTTPException) as e:
        _req(db, kid, t.id)
    assert e.value.status_code == 400


def test_unsellable_group_dropped_then_collapses(db, kid):
    _setup_prices(db, kid)
    t, c = _grp(db, "Tablets"), _grp(db, "Consoles", 40)
    _dev(db, kid, 1, [t, c])
    _dev(db, kid, 2, [c])
    assert [o["scope"] for o in screen_time.options(db, get_family(db), kid)] == ["all"]
