import pytest
from app.api.rewards import redemption_name
from app.models.family import get_family
from app.models.lock import Device, DeviceGroup, Override
from app.models.points import Points, PointsType
from app.models.reward import Redemption
from app.services import economy, screen_time
from fastapi import HTTPException

ALL = {"group_id": None, "scope": "all", "name": "All my devices", "icon": "devices"}


def _dev(db, kid, n, groups=(), exempt=False):
    d = Device(mac=f"aa:bb:cc:dd:ee:{n:02d}", name=f"D{n}", status="assigned", exempt=exempt)
    d.owners.append(kid)
    d.groups.extend(groups)
    db.add(d)
    db.commit()
    return d


def _grp(db, name, price=None, chore_lock=True):
    g = DeviceGroup(name=name, screen_price=price, chore_lock=chore_lock)
    db.add(g)
    db.commit()
    return g


def _opts(db, kid):
    fam = get_family(db)
    fam.screen_time_price, fam.group_pricing = 20, True
    db.commit()
    return fam, screen_time.options(db, fam, kid)


def test_no_group_prices_single_all_option(db, kid):
    _dev(db, kid, 1, [_grp(db, "Tablets")])
    assert _opts(db, kid)[1] == [{**ALL, "price": 20}]


def test_group_price_adds_option(db, kid):
    t, c = _grp(db, "Tablets"), _grp(db, "Consoles", 40)
    _dev(db, kid, 1, [t])
    _dev(db, kid, 2, [c])
    got = _opts(db, kid)[1]
    assert got == [
        {**ALL, "price": 40},
        {"group_id": t.id, "scope": "group", "name": "Tablets", "icon": "devices", "price": 20},
        {"group_id": c.id, "scope": "group", "name": "Consoles", "icon": "devices", "price": 40},
    ]


def test_same_prices_collapse(db, kid):
    c = _grp(db, "Consoles", 40)
    _dev(db, kid, 1, [c])
    _dev(db, kid, 2, [c])
    assert _opts(db, kid)[1] == [{**ALL, "price": 40}]


def test_free_group_not_an_option(db, kid):
    s = _grp(db, "Speakers", 5, chore_lock=False)
    c = _grp(db, "Consoles", 40)
    _dev(db, kid, 1, [s])
    _dev(db, kid, 2, [c])
    _dev(db, kid, 3, [_grp(db, "Tablets", 10)])
    names = [o["name"] for o in _opts(db, kid)[1]]
    assert names == ["All my devices", "Consoles", "Tablets"]  # no Speakers


def test_exempt_device_ignored(db, kid):
    c = _grp(db, "Consoles", 40)
    _dev(db, kid, 1, [_grp(db, "Tablets")])
    _dev(db, kid, 2, [c], exempt=True)
    assert [o["name"] for o in _opts(db, kid)[1]] == ["All my devices"]


def test_price_for_rejects_foreign_group(db, kid):
    other = _grp(db, "Other", 40)
    _dev(db, kid, 1, [_grp(db, "Tablets")])
    fam, _ = _opts(db, kid)
    assert screen_time.price_for(db, fam, kid, "all", None) == 20
    with pytest.raises(HTTPException) as e:
        screen_time.price_for(db, fam, kid, "group", other.id)
    assert (e.value.status_code, e.value.detail) == (400, "Pick one of your options.")


def test_group_devices_shared_device(db, kid):
    c, t = _grp(db, "Consoles"), _grp(db, "Tablets")
    shared = _dev(db, kid, 1, [c, t])
    only_c = _dev(db, kid, 2, [c])
    assert screen_time.group_devices(kid, t.id) == [shared]
    assert set(screen_time.group_devices(kid, c.id)) == {shared, only_c}
    assert set(screen_time.group_devices(kid, None)) == {shared, only_c}


def _setup(db, kid, parent):
    """Tablets 20, Consoles 40; kid has one device in each and 500 points."""
    t, c = _grp(db, "Tablets"), _grp(db, "Consoles", 40)
    dt, dc = _dev(db, kid, 1, [t]), _dev(db, kid, 2, [c])
    fam = get_family(db)
    fam.screen_time_price, fam.points_unlock_early = 20, True
    fam.screen_auto_approve, fam.group_pricing = False, True
    db.add(Points(user_id=kid.id, points_type=PointsType.BONUS, amount=500, reason="bonus"))
    db.commit()
    return c, dt, dc


def _setup_prices(db, kid):
    fam = get_family(db)
    fam.screen_time_price, fam.points_unlock_early, fam.group_pricing = 20, True, True
    db.add(Points(user_id=kid.id, points_type=PointsType.BONUS, amount=500, reason="bonus"))
    db.commit()


def _req(db, kid, gid=None, scope=None):
    return economy.request(db, kid, "screen_time", None, 30, group_id=gid, scope=scope)


def test_request_group_cost(db, kid, parent):
    c, _, _ = _setup(db, kid, parent)
    red = _req(db, kid, c.id)
    assert (red.cost, red.device_group_id, red.screen_scope) == (80, c.id, "group")


def test_request_all_uses_max(db, kid, parent):
    _setup(db, kid, parent)
    assert _req(db, kid).cost == 80


def test_price_change_after_request_keeps_cost(db, kid, parent):
    c, _, _ = _setup(db, kid, parent)
    red = _req(db, kid, c.id)
    c.screen_price = 100
    db.commit()
    economy.decide(db, red, parent, True)
    amounts = [p.amount for p in db.query(Points).filter_by(user_id=kid.id, reason="redemption")]
    assert amounts == [-80]


def test_decide_unlocks_only_group(db, kid, parent):
    c, dt, dc = _setup(db, kid, parent)
    economy.decide(db, _req(db, kid, c.id), parent, True)
    assert {o.device_id for o in db.query(Override).filter_by(source="bonus")} == {dc.id}


def test_redemption_name_group(db, kid, parent):
    c, _, _ = _setup(db, kid, parent)
    assert redemption_name(db, _req(db, kid, c.id)) == "30 min on Consoles"


def _bonus_devs(db):
    return {o.device_id for o in db.query(Override).filter_by(source="bonus")}


def test_shared_device_not_unlocked_below_its_price(db, kid, parent):
    t, c = _grp(db, "Tablets"), _grp(db, "Consoles", 40)
    only_t = _dev(db, kid, 1, [t])
    shared = _dev(db, kid, 2, [t, c])
    _setup_prices(db, kid)
    economy.decide(db, _req(db, kid, t.id), parent, True)
    assert _bonus_devs(db) == {only_t.id}
    assert shared.id not in _bonus_devs(db)


def test_buy_all_unlocks_everything(db, kid, parent):
    t, c = _grp(db, "Tablets"), _grp(db, "Consoles", 40)
    ds = [_dev(db, kid, 1, [t]), _dev(db, kid, 2, [c]), _dev(db, kid, 3, [t, c])]
    _setup_prices(db, kid)
    economy.decide(db, _req(db, kid), parent, True)
    assert _bonus_devs(db) == {d.id for d in ds}


def test_invalid_group_no_redemption_no_charge(db, kid, parent):
    _setup(db, kid, parent)
    other = _grp(db, "Other", 40)
    before = economy.balance(db, kid.id)
    with pytest.raises(HTTPException) as e:
        _req(db, kid, other.id)
    assert e.value.status_code == 400
    assert db.query(Redemption).count() == 0
    assert economy.balance(db, kid.id) == before


def test_request_label_names_group(db, kid, parent):
    from app.models.inbox import Notification

    c, _, _ = _setup(db, kid, parent)
    _req(db, kid, c.id)
    assert any("30 min on Consoles" in (n.body or "") for n in db.query(Notification))
