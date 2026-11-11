from datetime import UTC, datetime, timedelta

from app.lock.hints import apply_hint
from app.lock.rules import block_reason
from app.lock.schedule import local_now
from app.lock.state import desired_blocked, device_facts
from app.models.family import get_family
from app.models.lock import Device, Override
from app.models.penalty import Penalty

NOW = datetime.now(UTC)


def _n():
    return NOW.replace(tzinfo=None)


def mk(db, mac, kid=None, **kw):
    d = Device(mac=mac, name="Timmy's iPad", status="assigned" if kid else "unassigned", **kw)
    d.owners = [kid] if kid else []
    db.add(d)
    db.commit()
    return d


def pen(db, kid, **kw):
    kw.setdefault("ends_at", _n() + timedelta(hours=2))
    p = Penalty(kid_id=kid.id, kind="block", amount=1, all_devices=True, **kw)
    db.add(p)
    db.commit()
    return p


def reason(db, d):
    f = device_facts(db, d, get_family(db), NOW)
    return block_reason(f, local_now(get_family(db).timezone, NOW))


def test_whole_kid_penalty_blocks_owned_not_exempt(db, kid):
    a = mk(db, "aa:00:00:00:00:01", kid)
    b = mk(db, "aa:00:00:00:00:02", kid, exempt=True)
    pen(db, kid)
    assert reason(db, a) == "penalty"
    assert reason(db, b) is None
    assert a.mac in desired_blocked(db, NOW) and b.mac not in desired_blocked(db, NOW)


def test_newly_assigned_device_is_blocked(db, kid):
    pen(db, kid)
    c = mk(db, "aa:00:00:00:00:03")
    c.owners = [kid]
    c.status = "assigned"
    db.commit()
    assert reason(db, c) == "penalty"


def test_ended_or_inactive_penalty_not_blocked(db, kid):
    a = mk(db, "aa:00:00:00:00:01", kid)
    p = pen(db, kid, ends_at=_n() - timedelta(minutes=1))
    assert reason(db, a) is None
    p.ends_at = _n() + timedelta(hours=1)
    p.status = "forgiven"
    db.commit()
    assert reason(db, a) is None


def _hint_setup(db, kid):
    old = mk(
        db, "aa:00:00:00:00:01", kid, mdns_name="x",
        first_seen=_n() - timedelta(days=9), last_seen=_n() - timedelta(hours=2),
    )  # fmt: skip
    exp = _n() + timedelta(hours=1)
    p = Penalty(kid_id=kid.id, kind="block", amount=1, ends_at=exp)
    db.add(p)
    db.commit()
    db.add(
        Override(
            device_id=old.id, action="lock", source="penalty", penalty_id=p.id,
            expires_at=exp, created_at=_n(),
        )
    )  # fmt: skip
    new = mk(db, "02:00:00:00:00:99", mdns_name="x", first_seen=_n(), last_seen=_n())
    db.commit()
    return old, new, p, exp


def test_hint_copies_penalty_override(db, kid):
    _, new, p, exp = _hint_setup(db, kid)
    assert apply_hint(db, new) is True
    db.commit()
    o = db.query(Override).filter_by(device_id=new.id, source="penalty").one()
    assert (o.penalty_id, o.expires_at) == (p.id, exp)
    assert reason(db, new) == "penalty"


def test_strict_mode_penalty_candidate_counts_as_paused(db, kid):
    get_family(db).new_devices_blocked = True
    _, new, _, _ = _hint_setup(db, kid)
    assert apply_hint(db, new) is True
