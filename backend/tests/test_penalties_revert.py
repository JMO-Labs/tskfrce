"""Taking back / undoing an approved make-up run reverses its earn-back slice."""

from datetime import UTC, datetime, timedelta

from app.models.chores import ChoreRun
from app.models.family import get_family
from app.models.lock import Device, Override
from app.models.penalty import Penalty
from app.models.points import Points, PointsType
from app.models.screen_bank import ScreenBank
from app.services import chore_actions, economy, penalties
from app.services import penalty_earnback as eb
from app.services.penalties import Give

B = "/api/v1"
NOW = datetime(2026, 11, 10, 15, 0, tzinfo=UTC)


def _runs(db, p):
    return db.query(ChoreRun).filter_by(penalty_id=p.id).order_by(ChoreRun.id).all()


def _approve(db, r, via="parent"):
    chore_actions.approve(db, r, None, via=via)
    db.commit()


def _now():
    return datetime.now(UTC)


def _points_pen(db, parent, kid, taken=20, back="all"):
    db.add(Points(user_id=kid.id, points_type=PointsType.BONUS, amount=50, description="t"))
    db.commit()
    [p] = penalties.give(db, [kid.id], Give("points", taken, back), parent, _now())
    return p


def _dev(db, kid):
    d = Device(mac="aa:bb:cc:dd:ee:01", name="D1", status="assigned")
    d.owners = [kid]
    db.add(d)
    db.commit()
    return d


def test_slice_stored_on_run(db, parent, kid):
    p = _points_pen(db, parent, kid)
    r1, _ = _runs(db, p)
    _approve(db, r1)
    assert r1.makeup_slice == 10


def test_points_revert_removes_refund_and_reapprove_caps(db, parent, kid):
    p = _points_pen(db, parent, kid)
    r1, r2 = _runs(db, p)
    _approve(db, r1)
    eb.on_reverted(db, r1, _now())
    r1.status = "todo"
    db.commit()
    assert p.amount_returned == 0 and r1.makeup_slice is None
    assert db.query(Points).filter_by(penalty_id=p.id, run_id=r1.id).count() == 0
    _approve(db, r1)
    _approve(db, r2)
    assert p.amount_returned == p.back_total == 20
    assert economy.balance(db, kid.id) == 50


def test_points_ended_penalty_reactivates(db, parent, kid):
    p = _points_pen(db, parent, kid)
    for r in _runs(db, p):
        _approve(db, r)
    assert p.status == "ended"
    r2 = _runs(db, p)[1]
    eb.on_reverted(db, r2, _now())
    r2.status = "todo"
    db.commit()
    assert p.status == "active" and p.ended_at is None and p.amount_returned == 10
    _approve(db, r2)
    assert p.status == "ended" and p.amount_returned == 20


def test_expired_penalty_not_reactivated(db, parent, kid):
    p = _points_pen(db, parent, kid)
    for r in _runs(db, p):
        _approve(db, r)
    p.ends_at = datetime.utcnow() - timedelta(minutes=1)
    db.commit()
    eb.on_reverted(db, _runs(db, p)[1], _now())
    assert p.status == "ended"


def test_screen_revert_takes_minutes(db, parent, kid):
    fam = get_family(db)
    fam.points_unlock_early, fam.screen_rollover, fam.screen_max_minutes = True, True, 60
    db.add(ScreenBank(kid_id=kid.id, minutes=30))
    db.commit()
    [p] = penalties.give(db, [kid.id], Give("screen", 20, "all"), parent, _now())
    r1, _ = _runs(db, p)
    _approve(db, r1)
    assert db.get(ScreenBank, kid.id).minutes == 20
    eb.on_reverted(db, r1, _now())
    db.commit()
    assert db.get(ScreenBank, kid.id).minutes == 10 and p.amount_returned == 0


def test_block_revert_restores_end_and_override(db, parent, kid):
    d = _dev(db, kid)
    [p] = penalties.give(db, [kid.id], Give("block", 1440, "all", device_id=d.id), parent, _now())
    end = p.ends_at
    r1, r2 = _runs(db, p)
    _approve(db, r1)
    _approve(db, r2)
    assert p.status == "ended" and db.query(Override).count() == 0
    eb.on_reverted(db, r2, _now())
    db.commit()
    assert p.status == "active" and p.ended_at is None
    assert p.ends_at == end - timedelta(minutes=720)
    assert db.query(Override).filter_by(penalty_id=p.id).one().expires_at == p.ends_at


def test_take_back_api_reverses(client, db, parent, kid, parent_headers):
    p = _points_pen(db, parent, kid)
    r1, _ = _runs(db, p)
    _approve(db, r1, via="trust")
    res = client.post(f"{B}/chores/{r1.id}/take-back", json={}, headers=parent_headers)
    assert res.status_code == 200
    db.expire_all()
    p = db.get(Penalty, p.id)
    assert p.amount_returned == 0 and db.get(ChoreRun, r1.id).makeup_slice is None


def test_undo_api_reverses(client, db, parent, kid, parent_headers):
    p = _points_pen(db, parent, kid)
    r1, r2 = _runs(db, p)
    _approve(db, r1)
    assert client.post(f"{B}/chores/{r1.id}/undo", headers=parent_headers).status_code == 200
    db.expire_all()
    assert db.get(Penalty, p.id).amount_returned == 0
    _approve(db, db.get(ChoreRun, r1.id))
    _approve(db, db.get(ChoreRun, r2.id))
    assert db.get(Penalty, p.id).amount_returned == 20
