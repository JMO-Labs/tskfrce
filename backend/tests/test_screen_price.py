import pytest
from app.api.rewards import redemption_name
from app.models.family import get_family
from app.models.lock import Device, DeviceGroup, Override
from app.models.points import Points, PointsType
from app.services import economy, screen_time
from fastapi import HTTPException

ALL = {"group_id": None, "name": "All my devices", "icon": "devices"}


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
    fam.screen_time_price = 20
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
        {"group_id": t.id, "name": "Tablets", "icon": "devices", "price": 20},
        {"group_id": c.id, "name": "Consoles", "icon": "devices", "price": 40},
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
    assert screen_time.price_for(db, fam, kid, None) == 20
    with pytest.raises(HTTPException) as e:
        screen_time.price_for(db, fam, kid, other.id)
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
    fam.screen_auto_approve = False
    db.add(Points(user_id=kid.id, points_type=PointsType.BONUS, amount=500, reason="bonus"))
    db.commit()
    return c, dt, dc


def _req(db, kid, gid=None):
    return economy.request(db, kid, "screen_time", None, 30, group_id=gid)


def test_request_group_cost(db, kid, parent):
    c, _, _ = _setup(db, kid, parent)
    red = _req(db, kid, c.id)
    assert (red.cost, red.device_group_id) == (80, c.id)


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


def test_decide_deleted_group_unlocks_all(db, kid, parent):
    c, dt, dc = _setup(db, kid, parent)
    red = _req(db, kid, c.id)
    db.delete(db.get(DeviceGroup, c.id))
    db.commit()
    economy.decide(db, red, parent, True)
    assert {o.device_id for o in db.query(Override).filter_by(source="bonus")} == {dt.id, dc.id}
    assert db.query(Points).filter_by(reason="redemption").one().amount == -red.cost


def test_redemption_name_group(db, kid, parent):
    c, _, _ = _setup(db, kid, parent)
    assert redemption_name(db, _req(db, kid, c.id)) == "30 min on Consoles"
