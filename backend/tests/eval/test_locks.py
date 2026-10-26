from dataclasses import replace
from datetime import UTC, date, datetime, time

import pytest
from app.eval import hooks, locks, store
from app.lock import loop
from app.lock.rules import DeviceFacts, OwnerChores, is_online
from app.lock.schedule import Window
from app.models.chores import ChoreRun
from app.models.family import get_family
from app.models.lock import Device

from tests.factories import make_run

NOW = datetime(2026, 10, 19, 17, 0)  # Monday 17:00
INSIDE = Window(frozenset({0}), time(16), time(20))
OUTSIDE = Window(frozenset({0}), time(8), time(9))
PENDING = (OwnerChores(2, 1),)
DONE = (OwnerChores(2, 2),)
BASE = DeviceFacts(
    status="assigned",
    owners=DONE,
    allowed_sets=(),
    free=(),
    override=None,
    bonus_active=False,
    new_devices_blocked=True,
    points_unlock_early=False,
)
CASES = [
    ({"override": "lock", "status": "guest"}, "override"),
    ({"status": "guest", "owners": PENDING}, None),
    ({"status": "unassigned"}, "new_device"),
    ({"status": "unassigned", "new_devices_blocked": False}, None),
    ({"status": "unassigned", "override": "unlock"}, None),
    ({"allowed_sets": ((OUTSIDE,),)}, "hours"),
    ({"allowed_sets": ((OUTSIDE,),), "override": "unlock"}, "hours"),
    ({"allowed_sets": ((INSIDE,),), "owners": PENDING}, "chores"),
    ({"owners": PENDING, "free": (INSIDE,)}, None),
    ({"owners": PENDING, "free": (OUTSIDE,)}, "chores"),
    ({"owners": PENDING, "override": "unlock"}, None),
    ({"owners": PENDING, "bonus_active": True}, "chores"),
    ({"owners": PENDING, "bonus_active": True, "points_unlock_early": True}, None),
    ({"owners": (OwnerChores(0, 0),)}, None),
    ({"allowed_sets": ((INSIDE,),)}, None),
]


@pytest.mark.parametrize("kw,want", CASES)
def test_reason_matches_is_online(kw, want):
    f = replace(BASE, **kw)
    assert locks.reason(f, NOW) == want
    assert (locks.reason(f, NOW) is None) == is_online(f, NOW)


@pytest.fixture
def fresh():
    locks._last = None
    yield
    locks._last = None


T = datetime(2026, 10, 20, 15, 0, tzinfo=UTC)


def _umami(name):
    return [r for r in store.due(1e12, 100) if r.body["payload"]["name"] == name]


def test_track_counts_transitions(eval_on, db, parent, kid, fresh):
    get_family(db).last_reset_date = date(2026, 10, 20)
    d = Device(mac="aa:bb:cc:dd:ee:01", name="Tab", status="assigned")
    d.owners = [kid]
    db.add(d)
    make_run(db, parent, kid)
    day = store.local_day()
    locks.track(db, T)  # baseline: chores open
    assert "locks_by_chores" not in store.counters(day)
    db.query(ChoreRun).update({"status": "done", "approved_by_id": parent.id})
    db.commit()
    locks.track(db, T)
    db.query(ChoreRun).update({"status": "todo"})
    db.commit()
    locks.track(db, T)
    assert store.counters(day)["locks_by_chores"] == 1
    assert _umami("first_lock") == []
    store.kv_set("wizard_done_at", "0")
    db.query(ChoreRun).update({"status": "done", "approved_by_id": parent.id})
    db.commit()
    locks.track(db, T)
    db.query(ChoreRun).update({"status": "todo"})
    db.commit()
    locks.track(db, T)
    assert store.counters(day)["locks_by_chores"] == 2
    assert len(_umami("first_lock")) == 1


def test_hooks_never_raise(db, monkeypatch, eval_on, fresh):
    def boom(*a, **k):
        raise RuntimeError("boom")

    db.add(Device(mac="aa:bb:cc:dd:ee:02", name="Old", status="unassigned"))
    db.commit()
    monkeypatch.setattr(store, "bump", boom)
    locks._last = {}  # past baseline: the blocked device is a transition
    monkeypatch.setattr(locks, "reason", lambda f, t: "hours")
    assert hooks.after_tick(db) is None
    pushed = []
    monkeypatch.setattr(loop, "SessionLocal", lambda: db)
    monkeypatch.setattr(loop, "push_blocked", pushed.append)
    monkeypatch.setattr(db, "close", lambda: None)
    loop._run_once()
    assert pushed == [["aa:bb:cc:dd:ee:02"]]
