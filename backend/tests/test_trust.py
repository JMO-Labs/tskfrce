"""Trust mode rules: levels, spot-check rolls, clean counts and catches."""

import os
import subprocess
import sys
from pathlib import Path

from app.models.inbox import Notification
from app.models.trust import TrustEvent
from app.models.user import UserRole
from app.services import trust

from tests.conftest import _make_user
from tests.factories import make_run

BACKEND = Path(__file__).resolve().parents[1]


def _kid(db, kid, on=True, level=0, clean=0):
    kid.trust_mode, kid.trust_level, kid.trust_clean = on, level, clean
    db.commit()
    return kid


def _events(db):
    db.flush()
    return [(e.kid_id, e.kind) for e in db.query(TrustEvent).order_by(TrustEvent.id)]


def _msgs(db, kid, kind):
    return db.query(Notification).filter_by(user_id=kid.id, kind=kind).all()


def test_decide_wait_when_off(db, parent, kid):
    _kid(db, kid, on=False, level=2)
    r = make_run(db, parent, kid)
    assert trust.decide(db, r, [kid.id], rng=lambda: 0.99) == "wait"


def test_decide_wait_at_new(db, parent, kid):
    _kid(db, kid, level=0)
    r = make_run(db, parent, kid)
    assert trust.decide(db, r, [kid.id], rng=lambda: 0.99) == "wait"


def test_decide_always_check_waits(db, parent, kid):
    _kid(db, kid, level=2)
    r = make_run(db, parent, kid)
    r.assignment.chore.always_check = True
    assert trust.decide(db, r, [kid.id], rng=lambda: 0.99) == "wait"


def test_decide_makeup_always_waits(db, parent, kid):
    """Make-up chores skip trust auto-approve: a parent always checks them."""
    _kid(db, kid, level=2)
    r = make_run(db, parent, kid)
    r.assignment.chore.makeup = True
    assert trust.decide(db, r, [kid.id], rng=lambda: 0.99) == "wait"


def test_decide_redo_after_catch_waits(db, parent, kid):
    # owner ruling 2026-11-07: a chore caught once always waits for a parent next time
    r = make_run(db, parent, kid)
    _kid(db, kid, level=2)
    trust.catch(db, r, [kid.id], parent.id, lower=False)
    db.commit()  # catch and redo are separate requests
    assert trust.decide(db, r, [kid.id], rng=lambda: 0.99) == "wait"


def test_decide_rates(db, parent, kid):
    r = make_run(db, parent, kid)
    _kid(db, kid, level=1)
    assert trust.decide(db, r, [kid.id], rng=lambda: 0.19) == "spot"
    assert trust.decide(db, r, [kid.id], rng=lambda: 0.21) == "auto"
    _kid(db, kid, level=2)
    assert trust.decide(db, r, [kid.id], rng=lambda: 0.04) == "spot"
    assert trust.decide(db, r, [kid.id], rng=lambda: 0.06) == "auto"


def test_team_uses_lowest_and_any_off_waits(db, parent, kid):
    kid2 = _make_user(db, "sam", UserRole.KID)
    r = make_run(db, parent, kids=[kid, kid2], mode="team")
    _kid(db, kid, level=2)
    _kid(db, kid2, level=1)
    ids = [kid.id, kid2.id]
    assert trust.decide(db, r, ids, rng=lambda: 0.19) == "spot"  # lowest is Trusted
    assert trust.decide(db, r, ids, rng=lambda: 0.21) == "auto"
    _kid(db, kid2, on=False, level=2)
    assert trust.decide(db, r, ids, rng=lambda: 0.99) == "wait"


def test_payees_follow_recipients(db, parent, kid):
    r = make_run(db, parent, kid)
    assert trust.payees(r) == [kid.id]


def test_clean_promotes_at_10_then_30(db, kid):
    _kid(db, kid, level=0, clean=9)
    trust.count_clean(db, [kid.id])
    assert (kid.trust_level, kid.trust_clean) == (1, 0)
    kid.trust_clean = 29
    trust.count_clean(db, [kid.id])
    assert (kid.trust_level, kid.trust_clean) == (2, 0)
    trust.count_clean(db, [kid.id])  # Proven stays Proven
    assert (kid.trust_level, kid.trust_clean) == (2, 1)
    assert _events(db) == [(kid.id, "up"), (kid.id, "up")]
    assert _msgs(db, kid, "trust_up")[0].title == "You're now Trusted!"


def test_clean_notifies_parent(db, parent, kid):
    _kid(db, kid, clean=9)
    kid.full_name = "Timmy"
    trust.count_clean(db, [kid.id])
    p = _msgs(db, parent, "trust_up")
    assert p and "Timmy is now Trusted" in p[0].title


def test_clean_ignored_when_off(db, kid):
    _kid(db, kid, on=False, clean=9)
    trust.count_clean(db, [kid.id])
    assert (kid.trust_level, kid.trust_clean) == (0, 9)
    assert _events(db) == []


def test_catch_drops_one_and_floors_at_new(db, parent, kid):
    r = make_run(db, parent, kid)
    _kid(db, kid, level=2, clean=5)
    trust.catch(db, r, [kid.id], parent.id, lower=True)
    assert (kid.trust_level, kid.trust_clean) == (1, 0)
    trust.catch(db, r, [kid.id], parent.id, lower=True)
    trust.catch(db, r, [kid.id], parent.id, lower=True)
    assert kid.trust_level == 0
    assert _events(db)[:2] == [(kid.id, "catch"), (kid.id, "down")]
    assert _msgs(db, kid, "trust_down")[0].title.startswith("Your trust level went back to")


def test_catch_without_lower_only_resets_count(db, parent, kid):
    r = make_run(db, parent, kid)
    _kid(db, kid, level=2, clean=5)
    trust.catch(db, r, [kid.id], parent.id, lower=False)
    assert (kid.trust_level, kid.trust_clean) == (2, 0)
    assert _events(db) == [(kid.id, "catch")]


def test_set_level_resets_count(db, parent, kid):
    _kid(db, kid, level=1, clean=7)
    trust.set_level(db, kid, 2, parent.id)
    assert (kid.trust_level, kid.trust_clean) == (2, 0)
    trust.set_level(db, kid, 0, parent.id)
    assert _events(db) == [(kid.id, "up"), (kid.id, "down")]


def test_migration_roundtrip(tmp_path):
    url = f"sqlite:///{tmp_path / 'm.db'}"
    for cmd in (["upgrade", "head"], ["downgrade", "a0b1c2d3e4f5"], ["upgrade", "head"]):
        subprocess.run(
            [sys.executable, "-m", "alembic", *cmd],
            cwd=BACKEND,
            env={**os.environ, "DATABASE_URL": url},
            check=True,
            capture_output=True,
        )
