from datetime import UTC, datetime, timedelta

import pytest
from app.lock import state
from app.models.chores import ChoreRun
from app.models.family import get_family
from app.models.lock import Device, Override
from app.models.penalty import Penalty
from app.models.points import Points, PointsType
from app.models.screen_bank import ScreenBank
from app.services import chore_actions, economy, penalties
from app.services import penalty_earnback as eb
from app.services.penalties import Give

NOW = datetime(2026, 11, 10, 15, 0, tzinfo=UTC)
NAIVE = NOW.replace(tzinfo=None)


def _pts(db, kid, n):
    db.add(Points(user_id=kid.id, points_type=PointsType.BONUS, amount=n, description="t"))
    db.commit()


def _runs(db, p):
    return db.query(ChoreRun).filter_by(penalty_id=p.id).order_by(ChoreRun.id).all()


def _approve(db, r, via="parent"):
    chore_actions.approve(db, r, None, via=via)
    db.commit()


def _points_pen(db, parent, kid, taken=20, back="half"):
    _pts(db, kid, 50)
    [p] = penalties.give(db, [kid.id], Give("points", taken, back), parent, NOW)
    return p


def test_points_slices_refund(db, parent, kid):
    p = _points_pen(db, parent, kid, 20, "half")
    assert p.back_total == 10
    r1, r2 = _runs(db, p)
    _approve(db, r1)
    assert economy.balance(db, kid.id) == 35 and p.status == "active"
    _approve(db, r2)
    assert economy.balance(db, kid.id) == 40 and p.status == "ended"


def test_slice_remainder_on_last(db, parent, kid):
    _pts(db, kid, 50)
    [p] = penalties.give(db, [kid.id], Give("points", 7, "all"), parent, NOW)
    r1, r2 = _runs(db, p)
    assert p.back_total == 7
    _approve(db, r1)
    assert db.query(Points).filter_by(penalty_id=p.id, amount=3).count() == 1
    _approve(db, r2)
    assert db.query(Points).filter_by(penalty_id=p.id, amount=4).count() == 1


def test_screen_slice_rebanks(db, parent, kid):
    fam = get_family(db)
    fam.points_unlock_early, fam.screen_rollover, fam.screen_max_minutes = True, True, 60
    db.add(ScreenBank(kid_id=kid.id, minutes=30))
    db.commit()
    [p] = penalties.give(db, [kid.id], Give("screen", 20, "half"), parent, NOW)
    assert db.get(ScreenBank, kid.id).minutes == 10
    r1, _ = _runs(db, p)
    _approve(db, r1)
    assert db.get(ScreenBank, kid.id).minutes == 15 and p.amount_returned == 5


def _block_pen(db, parent, kid, device=None, n=2):
    base = datetime.utcnow()  # approvals stamp the real clock
    p = Penalty(
        kid_id=kid.id, kind="block", amount=1440, amount_taken=1440, earn_back="half",
        back_total=720, makeup_count=n, created_at=base, ends_at=base + timedelta(days=1),
        all_devices=device is None,
    )  # fmt: skip
    db.add(p)
    db.flush()
    if device:
        db.add(Override(device_id=device.id, action="lock", source="penalty",
                        expires_at=p.ends_at, penalty_id=p.id))  # fmt: skip
    for t in range(n):
        penalties._makeup_runs(db, kid, p, [f"c{t}"], parent, NOW)
    db.commit()
    return p


def _dev2(db, kid):
    return _dev(db, kid, 2)


def _dev(db, kid, n=1):
    d = Device(mac=f"aa:bb:cc:dd:ee:{n:02x}", name=f"D{n}", status="assigned")
    d.owners = [kid]
    db.add(d)
    db.commit()
    return d


def test_block_slice_pulls_end_earlier(db, parent, kid):
    d = _dev(db, kid)
    p = _block_pen(db, parent, kid, d)
    end = p.ends_at
    r1, r2 = _runs(db, p)
    _approve(db, r1)
    assert p.ends_at == end - timedelta(minutes=360)
    assert db.query(Override).filter_by(penalty_id=p.id).one().expires_at == p.ends_at
    _approve(db, r2)
    assert p.status == "active" and p.ends_at == end - timedelta(minutes=720)
    assert db.query(Override).filter_by(penalty_id=p.id).one().expires_at == p.ends_at


def test_block_whole_kid_moves_ends_at(db, parent, kid):
    p = _block_pen(db, parent, kid)
    end = p.ends_at
    _approve(db, _runs(db, p)[0])
    assert p.ends_at == end - timedelta(minutes=360) and p.status == "active"
    _approve(db, _runs(db, p)[1])
    assert p.ends_at == end - timedelta(minutes=720) and p.status == "active"


def test_block_all_back_ends_now(db, parent, kid):
    p = _block_pen(db, parent, kid, _dev(db, kid))
    p.back_total = 1440
    db.commit()
    for r in _runs(db, p):
        _approve(db, r)
    assert p.status == "ended" and db.query(Override).count() == 0


def test_makeup_via_trust_auto_still_earns(db, parent, kid):
    p = _points_pen(db, parent, kid, 20, "all")
    _approve(db, _runs(db, p)[0], via="trust")
    assert p.amount_returned == 10


def test_shorten_block(db, parent, kid):
    d = _dev(db, kid)
    p = _block_pen(db, parent, kid, d)
    end = p.ends_at
    eb.shorten(db, p, 60, NOW)
    assert p.ends_at == end - timedelta(hours=1)
    assert db.query(Override).one().expires_at == p.ends_at
    eb.shorten(db, p, 99999, NOW)
    assert p.status == "ended" and db.query(Override).count() == 0


def test_shorten_points_rejected(db, parent, kid):
    p = _points_pen(db, parent, kid)
    with pytest.raises(ValueError):
        eb.shorten(db, p, 10, NOW)


def test_forgive_keeps_taken_points_cancels_makeup(db, parent, kid):
    p = _points_pen(db, parent, kid)
    eb.forgive(db, p, NOW)
    assert p.status == "forgiven" and economy.balance(db, kid.id) == 30
    assert {r.status for r in _runs(db, p)} == {"cancelled"}


def test_cancel_points_deletes_ledger_rows(db, parent, kid):
    p = _points_pen(db, parent, kid)
    _approve(db, _runs(db, p)[0])
    eb.cancel(db, p, NOW)
    assert p.status == "cancelled" and economy.balance(db, kid.id) == 50
    assert db.query(Points).filter_by(penalty_id=p.id).count() == 0
    assert {r.status for r in _runs(db, p)} == {"done", "cancelled"}


def test_cancel_points_after_spent_never_negative(db, parent, kid):
    p = _points_pen(db, parent, kid, 20, "all")
    _approve(db, _runs(db, p)[0])
    db.add(Points(user_id=kid.id, points_type=PointsType.REDEMPTION, amount=-35, description="x"))
    db.commit()
    before = economy.balance(db, kid.id)
    eb.cancel(db, p, NOW)
    assert economy.balance(db, kid.id) >= max(before, 0)


def test_cancel_screen_rebanks_unreturned(db, parent, kid):
    fam = get_family(db)
    fam.points_unlock_early, fam.screen_rollover, fam.screen_max_minutes = True, True, 60
    db.add(ScreenBank(kid_id=kid.id, minutes=30))
    db.commit()
    [p] = penalties.give(db, [kid.id], Give("screen", 20, "half"), parent, NOW)
    _approve(db, _runs(db, p)[0])
    eb.cancel(db, p, NOW)
    assert db.get(ScreenBank, kid.id).minutes == 30


def test_cancel_block_removes_overrides(db, parent, kid):
    p = _block_pen(db, parent, kid, _dev(db, kid))
    eb.cancel(db, p, NOW)
    assert p.status == "cancelled" and db.query(Override).count() == 0


def test_expire_ends_due_penalties(db, parent, kid):
    p = _points_pen(db, parent, kid)
    p.ends_at = NAIVE - timedelta(minutes=1)
    db.commit()
    assert eb.expire(db, NOW) == 1
    db.commit()
    assert p.status == "ended" and {r.status for r in _runs(db, p)} == {"cancelled"}


def test_tick_expires_penalties(db, parent, kid):
    p = _block_pen(db, parent, kid, _dev(db, kid))
    p.ends_at = NAIVE - timedelta(minutes=1)
    db.commit()
    state.tick(db, NOW)
    assert p.status == "ended" and {r.status for r in _runs(db, p)} == {"cancelled"}


def _give_block(db, parent, kid, earn_back="half", **kw):
    [p] = penalties.give(
        db,
        [kid.id],
        Give("block", 1440, earn_back, **kw),
        parent,
        datetime.utcnow().replace(tzinfo=UTC),
    )
    return p


def test_block_earnback_through_give(db, parent, kid):
    _dev(db, kid)
    p = _give_block(db, parent, kid)
    end, runs = p.ends_at, _runs(db, p)
    assert len(runs) == 2 and p.back_total == 720
    _approve(db, runs[0])
    _approve(db, runs[1])
    assert p.status == "active" and p.ends_at == end - timedelta(minutes=720)


def test_block_earnback_all_ends_through_give(db, parent, kid):
    d = _dev(db, kid)
    p = _give_block(db, parent, kid, "all", device_id=d.id)
    for r in _runs(db, p):
        _approve(db, r)
    assert p.status == "ended" and db.query(Override).count() == 0


def test_cancel_block_after_one_slice(db, parent, kid):
    d = _dev(db, kid)
    p = _give_block(db, parent, kid, device_id=d.id)
    _approve(db, _runs(db, p)[0])
    eb.cancel(db, p, datetime.now(UTC))
    assert p.status == "cancelled" and db.query(Override).count() == 0
    assert sorted(r.status for r in _runs(db, p)) == ["cancelled", "done"]


def test_forgive_block_unblocks(db, parent, kid):
    d = _dev(db, kid)
    now = datetime.now(UTC)
    p = _give_block(db, parent, kid)
    assert d.mac in state.desired_blocked(db, now)
    eb.forgive(db, p, now)
    assert p.status == "forgiven" and {r.status for r in _runs(db, p)} == {"cancelled"}
    assert d.mac not in state.desired_blocked(db, now)
    dv = _dev2(db, kid)
    q = _give_block(db, parent, kid, device_id=dv.id)
    eb.forgive(db, q, now)
    assert db.query(Override).count() == 0
