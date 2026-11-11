"""Penalty model: defaults and the new ledger/override links."""

from app.models import Device, Override, Points, PointsType, get_family
from app.models.penalty import Penalty


def _pen(db, kid, **kw):
    p = Penalty(kid_id=kid.id, kind="points", amount=10, earn_back="none", **kw)
    db.add(p)
    db.commit()
    return p


def test_penalty_row_defaults(db, kid):
    p = _pen(db, kid)
    assert p.status == "active"
    assert p.amount_returned == 0
    assert p.amount_taken == 0
    assert p.seen_by_kid is False
    assert p.created_at is not None


def test_override_accepts_penalty_source(db, kid):
    p = _pen(db, kid)
    d = Device(mac="aa:bb:cc:dd:ee:01", name="x")
    db.add(d)
    db.commit()
    db.add(Override(device_id=d.id, action="lock", source="penalty", penalty_id=p.id))
    db.commit()


def test_points_accepts_penalty_reason(db, kid):
    p = _pen(db, kid)
    db.add(
        Points(
            user_id=kid.id,
            points_type=PointsType.PENALTY,
            amount=-5,
            reason="penalty",
            penalty_id=p.id,
        )
    )
    db.commit()


def test_family_penalties_off_by_default(db):
    assert get_family(db).penalties_enabled is False
