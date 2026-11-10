from datetime import UTC, datetime, timedelta

import pytest
from app.lock import state
from app.models.chores import ChoreRun
from app.models.family import get_family
from app.models.inbox import Notification
from app.models.lock import Device, DeviceGroup, Override
from app.models.penalty import Penalty
from app.models.points import Points, PointsType
from app.models.screen_bank import ScreenBank
from app.models.user import UserRole
from app.services import economy, penalties
from app.services.penalties import Give
from fastapi import HTTPException

from tests.conftest import _make_user

NOW = datetime(2026, 11, 10, 15, 0, tzinfo=UTC)


def _pts(db, kid, n):
    db.add(Points(user_id=kid.id, points_type=PointsType.BONUS, amount=n, description="t"))
    db.commit()


def _dev(db, n, owner=None, exempt=False):
    d = Device(mac=f"aa:bb:cc:dd:ee:{n:02x}", name=f"Dev{n}", status="assigned", exempt=exempt)
    if owner:
        d.owners = [owner]
    db.add(d)
    db.commit()
    return d


def _block(**kw):
    return Give(kind="block", amount=1440, earn_back="half", **kw)


def test_give_points_takes_and_records(db, parent, kid):
    _pts(db, kid, 50)
    [p] = penalties.give(db, [kid.id], Give("points", 20, "all"), parent, NOW)
    assert p.amount_taken == 20 and p.back_total == 20 and p.makeup_count == 2
    row = db.query(Points).filter_by(reason="penalty").one()
    assert row.penalty_id == p.id and row.amount == -20
    assert economy.balance(db, kid.id) == 30
    assert db.query(ChoreRun).filter_by(penalty_id=p.id).count() == 2


def test_give_points_zero_balance(db, parent, kid):
    [p] = penalties.give(db, [kid.id], Give("points", 20, "all"), parent, NOW)
    assert p.amount_taken == 0 and p.back_total == 0
    assert db.query(ChoreRun).filter_by(penalty_id=p.id).count() == 0
    assert p.status == "ended"
    assert db.query(Notification).filter_by(user_id=kid.id, kind="points_taken").count() == 1


def test_give_screen_takes_bank_floor_zero(db, parent, kid):
    fam = get_family(db)
    fam.points_unlock_early, fam.screen_rollover, fam.screen_max_minutes = True, True, 60
    db.add(ScreenBank(kid_id=kid.id, minutes=30))
    db.commit()
    [p] = penalties.give(db, [kid.id], Give("screen", 45, "none"), parent, NOW)
    assert p.amount_taken == 30
    assert db.get(ScreenBank, kid.id).minutes == 0


def test_give_block_all_devices(db, parent, kid):
    a, b = _dev(db, 1, kid), _dev(db, 2, kid)
    ex = _dev(db, 3, kid, exempt=True)
    [p] = penalties.give(db, [kid.id], _block(), parent, NOW)
    assert p.all_devices is True and p.label == "devices" and p.amount_taken == 1440
    assert p.ends_at == NOW.replace(tzinfo=None) + timedelta(minutes=1440)
    assert db.query(Override).count() == 0
    blocked = state.desired_blocked(db, NOW)
    assert a.mac in blocked and b.mac in blocked and ex.mac not in blocked
    late = _dev(db, 4, kid)  # a device added later is covered too
    assert late.mac in state.desired_blocked(db, NOW)


def test_give_block_device_and_group_only_kids_devices(db, parent, kid):
    sib = _make_user(db, "sis", UserRole.KID)
    mine, theirs = _dev(db, 1, kid), _dev(db, 2, sib)
    g = DeviceGroup(name="Consoles")
    g.devices = [mine, theirs]
    db.add(g)
    db.commit()
    [p] = penalties.give(db, [kid.id], _block(group_id=g.id), parent, NOW)
    ov = db.query(Override).one()
    assert (ov.device_id, ov.source, ov.action, ov.penalty_id) == (mine.id, "penalty", "lock", p.id)
    assert ov.expires_at == p.ends_at and p.label == "Consoles" and not p.all_devices
    [q] = penalties.give(db, [kid.id], _block(device_id=mine.id), parent, NOW)
    assert q.label == "Dev1"


def test_family_penalty_one_row_per_kid_shared_group(db, parent, kid):
    sib = _make_user(db, "sis", UserRole.KID)
    _dev(db, 1, kid)
    rows = penalties.give(db, [kid.id, sib.id], _block(), parent, NOW)
    assert len(rows) == 2 and rows[0].group_id == rows[1].group_id and rows[0].group_id
    assert [r.amount_taken for r in rows] == [1440, 0]
    assert db.query(Notification).filter_by(user_id=sib.id).count() == 1


def test_makeup_runs_created(db, parent, kid):
    _pts(db, kid, 50)
    [p] = penalties.give(db, [kid.id], Give("points", 20, "all"), parent, NOW)
    runs = db.query(ChoreRun).filter_by(penalty_id=p.id).all()
    assert len(runs) == 2
    for r in runs:
        c = r.assignment.chore
        assert (r.kid_id, r.status, c.makeup, c.points) == (kid.id, "todo", True, 0)
        assert r.assignment.repeat == "once"


def test_custom_makeup_picks(db, parent, kid):
    _pts(db, kid, 50)
    [p] = penalties.give(
        db, [kid.id], Give("points", 20, "all", makeup=["Rake leaves"]), parent, NOW
    )
    [r] = db.query(ChoreRun).filter_by(penalty_id=p.id).all()
    assert r.assignment.chore.title == "Rake leaves" and p.makeup_count == 1


def test_recent_count_skips_cancelled(db, parent, kid):
    [_a] = penalties.give(db, [kid.id], Give("points", 5, "none"), parent, NOW)
    [b] = penalties.give(db, [kid.id], Give("points", 5, "none"), parent, NOW)
    assert penalties.recent_count(db, kid.id, NOW) == 2
    b.status = "cancelled"
    db.commit()
    assert penalties.recent_count(db, kid.id, NOW) == 1
    assert penalties.recent_count(db, kid.id, NOW + timedelta(days=8)) == 0


def test_notification_to_kid_only(db, parent, kid):
    sib = _make_user(db, "sis", UserRole.KID)
    _pts(db, kid, 50)
    penalties.give(db, [kid.id], Give("points", 5, "none", reason="Hit"), parent, NOW)
    n = db.query(Notification).filter_by(user_id=kid.id).one()
    assert (n.kind, n.title) == ("points_taken", "Mom gave you a penalty")
    assert n.body == "5 points · Hit"
    assert db.query(Notification).filter_by(user_id=sib.id).count() == 0


@pytest.mark.parametrize(
    "kind,amount,label,text",
    [
        ("points", 20, None, "20 points"),
        ("screen", 30, None, "30 min of saved screen time"),
        ("block", 1440, "Nintendo", "No Nintendo, 1 day"),
        ("block", 4320, "devices", "No devices, 3 days"),
        ("block", 120, "devices", "No devices, 2 hours"),
        ("block", 1620, "devices", "No devices, 1 day 3 hours"),
    ],
)
def test_summary_texts(kind, amount, label, text):
    p = Penalty(kind=kind, amount=amount, amount_taken=amount, label=label)
    assert penalties.summary(p) == text


def test_out_shape(db, parent, kid):
    _pts(db, kid, 50)
    [p] = penalties.give(db, [kid.id], Give("points", 20, "all"), parent, NOW)
    o = penalties.out(db, p)
    assert o["given_by"] == "Mom" and o["summary"] == "20 points"
    assert [m["status"] for m in o["makeup"]] == ["todo", "todo"]
    assert o["created_at"].endswith("Z")


def test_block_half_earnback_makes_runs(db, parent, kid):
    _dev(db, 1, kid)
    [p] = penalties.give(db, [kid.id], _block(), parent, NOW)
    assert p.back_total == 720 and p.makeup_count == 2 and p.status == "active"
    assert p.ends_at == NOW.replace(tzinfo=None) + timedelta(minutes=1440)
    assert db.query(ChoreRun).filter_by(penalty_id=p.id).count() == 2


def test_deviceless_block_no_runs(db, parent, kid):
    [p] = penalties.give(db, [kid.id], _block(), parent, NOW)
    assert p.amount_taken == 0 and p.back_total == 0 and p.status == "active"
    assert db.query(ChoreRun).filter_by(penalty_id=p.id).count() == 0


def test_give_is_atomic(db, parent, kid, monkeypatch):
    _pts(db, kid, 50)

    def boom(*a, **k):
        raise RuntimeError("x")

    monkeypatch.setattr(penalties, "_makeup_runs", boom)
    with pytest.raises(RuntimeError):
        penalties.give(db, [kid.id], Give("points", 20, "all"), parent, NOW)
    assert db.query(Penalty).count() == 0
    assert db.query(Points).filter_by(reason="penalty").count() == 0
    assert economy.balance(db, kid.id) == 50


def test_summary_uses_taken(db, parent, kid):
    _pts(db, kid, 5)
    [p] = penalties.give(db, [kid.id], Give("points", 20, "none"), parent, NOW)
    assert penalties.summary(p) == "5 points"
    assert db.query(Notification).filter_by(user_id=kid.id).one().body == "5 points"


def test_device_not_owned_rejected(db, parent, kid):
    sib = _make_user(db, "sis", UserRole.KID)
    d = _dev(db, 1, sib)
    with pytest.raises(HTTPException):
        penalties.give(db, [kid.id], _block(device_id=d.id), parent, NOW)
