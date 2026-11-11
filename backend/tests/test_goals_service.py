"""Goals service: points move through the ledger under SPEND_LOCK."""

import pytest
from app.models.family import get_family
from app.models.goal import Goal, GoalContribution, GoalParty
from app.models.inbox import Notification
from app.models.lock import Device, Override
from app.models.points import Points, PointsType
from app.models.reward import Redemption
from app.models.user import User, UserRole
from app.services import economy, goals, progression
from fastapi import HTTPException


def _fund(db, kid, n):
    db.add(Points(user_id=kid.id, points_type=PointsType.BONUS, amount=n, description="t"))
    db.commit()


def _goal(db, parent, kid=None, target=100, **kw):
    g = Goal(
        name="Bike",
        kind=kw.pop("kind", "custom"),
        kid_id=kid.id if kid else None,
        target=target,
        status="active",
        created_by_id=parent.id,
        **kw,
    )
    db.add(g)
    db.commit()
    return g


def _kid2(db, name):
    u = User(
        username=name,
        email=f"{name}@family.local",
        hashed_password="x",
        full_name=name.title(),
        role=UserRole.KID,
    )
    db.add(u)
    db.commit()
    return u


def _status(code, fn, *a):
    with pytest.raises(HTTPException) as e:
        fn(*a)
    assert e.value.status_code == code
    return e.value.detail


def test_save_moves_points(db, parent, kid):
    _fund(db, kid, 100)
    g = _goal(db, parent, kid)
    assert goals.save(db, g, kid, 30) == 30
    assert economy.balance(db, kid.id) == 70
    assert goals.saved(db, g.id) == 30
    assert goals.given(db, g.id, kid.id) == 30
    row = db.query(Points).filter(Points.reason == "goal_save").one()
    assert (row.amount, row.points_type, row.description) == (
        -30,
        PointsType.TRANSFER,
        "Saved to Bike",
    )


def test_save_never_overdraws(db, parent, kid):
    _fund(db, kid, 100)
    g = _goal(db, parent, kid, target=500)
    goals.save(db, g, kid, 80)
    _status(409, goals.save, db, g, kid, 80)
    assert economy.balance(db, kid.id) == 20


def test_save_respects_held_points(db, parent, kid):
    _fund(db, kid, 100)
    db.add(Redemption(kid_id=kid.id, kind="screen_time", minutes=15, cost=70, status="pending"))
    db.commit()
    g = _goal(db, parent, kid, target=500)
    _status(409, goals.save, db, g, kid, 40)
    assert goals.save(db, g, kid, 30) == 30


def test_save_stops_at_target_and_marks_full(db, parent, kid):
    _fund(db, kid, 100)
    g = _goal(db, parent, kid, target=60)
    assert goals.save(db, g, kid, 90) == 60
    assert g.status == "full" and g.reached_at is not None
    assert economy.balance(db, kid.id) == 40
    assert db.query(Notification).filter(Notification.kind == "goal_full").count() == 1
    _status(409, goals.save, db, g, kid, 5)


def test_withdraw_rules(db, parent, kid):
    _fund(db, kid, 100)
    g = _goal(db, parent, kid, target=500)
    goals.save(db, g, kid, 50)
    _status(409, goals.withdraw, db, g, kid, 60)
    assert goals.withdraw(db, g, kid, 20) == 20
    assert economy.balance(db, kid.id) == 70
    assert db.query(Points).filter(Points.reason == "goal_return").one().amount == 20
    get_family(db).goal_withdraw = False
    db.commit()
    _status(409, goals.withdraw, db, g, kid, 5)
    get_family(db).goal_withdraw = True
    g.status = "full"
    db.commit()
    _status(409, goals.withdraw, db, g, kid, 5)
    fg = _goal(db, parent, None, target=500)
    goals.save(db, fg, kid, 10)
    _status(409, goals.withdraw, db, fg, kid, 5)


def test_chip_in_has_no_ledger_row(db, parent, kid):
    fg = _goal(db, parent, None, target=100)
    assert goals.chip_in(db, fg, parent, 40) == 40
    assert goals.saved(db, fg.id) == 40
    assert db.query(Points).count() == 0
    _status(409, goals.chip_in, db, _goal(db, parent, kid), parent, 5)


def test_delete_family_returns_each_kid(db, parent, kid):
    k2, k3 = _kid2(db, "ann"), _kid2(db, "bo")
    fg = _goal(db, parent, None, target=500)
    for k, n in ((kid, 30), (k2, 20), (k3, 10)):
        _fund(db, k, 50)
        goals.save(db, fg, k, n)
    goals.chip_in(db, fg, parent, 99)
    gid = fg.id
    goals.delete(db, fg)
    assert db.get(Goal, gid) is None
    assert [economy.balance(db, k.id) for k in (kid, k2, k3)] == [50, 50, 50]


def test_fulfill_family_parties_for_every_kid(db, parent, kid):
    k2 = _kid2(db, "ann")
    gone = _kid2(db, "old")
    gone.is_active = False
    db.commit()
    fg = _goal(db, parent, None, target=10)
    _status(409, goals.fulfill, db, fg, parent)
    goals.chip_in(db, fg, parent, 10)
    assert fg.status == "full"
    goals.fulfill(db, fg, parent)
    assert fg.status == "fulfilled" and fg.fulfilled_by_id == parent.id and fg.fulfilled_at
    assert {p.kid_id for p in db.query(GoalParty).all()} == {kid.id, k2.id}


def test_fulfill_screen_goal_grants_free_minutes(db, parent, kid):
    d = Device(name="tab", mac="aa:bb:cc:00:00:01", status="assigned", owners=[kid])
    db.add(d)
    db.commit()
    g = _goal(db, parent, kid, target=10, kind="screen", minutes=60)
    _fund(db, kid, 10)
    goals.save(db, g, kid, 10)
    goals.fulfill(db, g, parent)
    o = db.query(Override).filter_by(device_id=d.id).one()
    assert (o.action, o.source, o.created_by_id) == ("unlock", "bonus", parent.id)
    assert 59 * 60 < (o.expires_at - o.created_at).total_seconds() <= 60 * 60
    assert not hasattr(goals, "ScreenBank")


def test_set_target_goes_both_ways(db, parent, kid):
    _fund(db, kid, 100)
    g = _goal(db, parent, kid, target=100)
    goals.save(db, g, kid, 50)
    goals.set_target(db, g, 40)
    assert g.status == "full"
    goals.set_target(db, g, 90)
    assert g.status == "active"


def test_xp_unchanged_by_save_and_withdraw(db, parent, kid):
    _fund(db, kid, 100)
    before = progression.xp(db, kid.id)
    g = _goal(db, parent, kid, target=500)
    goals.save(db, g, kid, 50)
    goals.withdraw(db, g, kid, 10)
    assert progression.xp(db, kid.id) == before


def test_helpers(db, parent, kid):
    fam = get_family(db)
    kid.age_group = "teen"
    assert goals.max_for(fam, kid) == 3
    kid.age_group = "little"
    assert goals.max_for(fam, kid) == 1
    _goal(db, parent, kid)
    assert goals.own_count(db, kid.id) == 1
    g = _goal(db, parent, kid)
    assert goals.waiting_on(db, g) is None  # no owner, no family owner
    get_family(db).owner_id = parent.id
    assert goals.waiting_on(db, g) == "Mom"
    g.owner_id = parent.id
    parent.full_name = None
    assert goals.waiting_on(db, g) == "mom"
    assert db.query(GoalContribution).count() == 0
