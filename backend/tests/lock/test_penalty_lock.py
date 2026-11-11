from dataclasses import replace
from datetime import UTC, datetime, timedelta

from app.lock.overrides import clear_override, set_override
from app.lock.state import device_facts
from app.models.family import get_family
from app.models.lock import Device, Override
from app.models.penalty import Penalty
from tests.lock.test_rules import NOW, facts


def test_penalty_blocks_inside_hours_with_chores_done():
    assert block_reason_of(facts(penalty=True)) == "penalty"


def block_reason_of(f):
    from app.lock.rules import block_reason

    return block_reason(f, NOW)


def test_penalty_beats_bonus():
    f = facts(penalty=True, bonus_active=True, points_unlock_early=True, bonus_any_hours=True)
    assert block_reason_of(f) == "penalty"


def test_penalty_beats_exempt():
    assert block_reason_of(facts(penalty=True, exempt=True)) == "penalty"


def test_manual_unlock_beats_penalty():
    assert block_reason_of(facts(penalty=True, override="unlock")) is None


def test_manual_lock_still_manual():
    assert block_reason_of(replace(facts(), penalty=True, override="lock")) == "manual"


def _now():
    return datetime.now(UTC).replace(tzinfo=None)


def _setup(db, kid, expires):
    d = Device(mac="aa:bb:cc:dd:ee:01", name="Dev", status="assigned")
    d.owners = [kid]
    p = Penalty(kid_id=kid.id, kind="block", amount=1, ends_at=expires)
    db.add_all([d, p])
    db.commit()
    db.add(
        Override(
            device_id=d.id,
            action="lock",
            source="penalty",
            penalty_id=p.id,
            expires_at=expires,
            created_at=_now(),
        )
    )
    db.commit()
    return d, p


def test_device_facts_sees_penalty_override(db, kid):
    d, _ = _setup(db, kid, _now() + timedelta(hours=1))
    fam = get_family(db)
    assert device_facts(db, d, fam, datetime.now(UTC)).penalty is True
    db.query(Override).update({"expires_at": _now() - timedelta(minutes=1)})
    db.commit()
    assert device_facts(db, d, fam, datetime.now(UTC)).penalty is False


def test_clear_override_keeps_penalty(db, kid, parent):
    d, _ = _setup(db, kid, _now() + timedelta(hours=1))
    clear_override(db, [d.id])
    set_override(db, [d.id], "unlock", 5, parent.id)
    db.commit()
    assert db.query(Override).filter(Override.source == "penalty").count() == 1


def test_device_payload_has_penalty(client, db, kid, parent_headers):
    d, p = _setup(db, kid, _now() + timedelta(hours=1))
    rows = client.get("/api/v1/devices", headers=parent_headers).json()
    row = next(r for r in rows if r["id"] == d.id)
    assert row["penalty"]["id"] == p.id
    assert row["penalty"]["ends_at"]
    assert row["reason"] == "penalty"


def test_device_payload_penalty_null_when_unlocked(client, db, kid, parent, parent_headers):
    d, _ = _setup(db, kid, _now() + timedelta(hours=1))
    set_override(db, [d.id], "unlock", 5, parent.id)
    db.commit()
    rows = client.get("/api/v1/devices", headers=parent_headers).json()
    row = next(r for r in rows if r["id"] == d.id)
    assert row["penalty"] is None and row["reason"] != "penalty"
