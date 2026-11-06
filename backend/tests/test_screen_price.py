import pytest
from app.models.family import get_family
from app.models.lock import Device, DeviceGroup
from app.services import screen_time
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
