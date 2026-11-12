import asyncio
from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace

from app.eval import heartbeat, hooks, listeners, store, worker
from app.models.chores import ChoreRun
from app.models.family import get_family

from tests.factories import DAY, make_chore


def _rows():
    return [r.body for r in store.due(9e18, 100) if r.kind == "umami"]


def _runs(db, parent, kid, statuses, submitted=()):
    _, a = make_chore(db, parent, kids=[kid])
    for i, st in enumerate(statuses):
        db.add(
            ChoreRun(
                assignment_id=a.id,
                day=DAY - timedelta(days=i),
                kid_id=kid.id,
                status=st,
                submitted_at=datetime(2026, 10, 20) if i in submitted else None,
            )
        )
    db.commit()


def test_build_has_every_key(eval_on, db):
    out = heartbeat.build(db, date(2026, 10, 24))
    assert set(out) == set(heartbeat.KEYS) and len(out) == len(heartbeat.KEYS)
    assert out["days_since_install"] == 0 and out["events_dropped"] == 0


def test_heartbeat_uses_family_day(eval_on, db):
    get_family(db).timezone = "America/New_York"
    db.commit()
    store.set_tz("America/New_York")
    store.bump("chores_done", day="2026-10-24")
    store.kv_set("first_day", "2026-10-20")
    now = datetime(2026, 10, 25, 5, 0, tzinfo=UTC)
    assert heartbeat.maybe_send(db, now) is True
    data = _rows()[0]["payload"]["data"]
    assert data["day"] == "2026-10-24" and data["chores_done"] == 1
    assert heartbeat.maybe_send(db, now) is False


def test_dropped_shows_in_that_days_heartbeat(eval_on, db):
    store.bump("dropped", 7, day="2026-10-24")
    assert heartbeat.build(db, date(2026, 10, 24))["dropped"] == 7
    assert heartbeat.build(db, date(2026, 10, 23))["dropped"] == 0


def test_heartbeat_exempt_from_cap(eval_on, db):
    store.kv_set("first_day", "2026-10-20")
    day = store.local_day()
    store.bump("enq", store.DAILY_CAP, day=day)
    now = datetime.now(UTC) + timedelta(days=1)
    assert heartbeat.maybe_send(db, now) is True
    assert len(_rows()) == 1
    assert store.counters(day).get("dropped", 0) == 0


def test_no_heartbeat_before_first_boot(eval_on, db):
    now = datetime(2026, 10, 25, 12, 0, tzinfo=UTC)
    assert heartbeat.maybe_send(db, now) is False
    assert store.kv_get("first_day") == store.local_day(now)


def test_stale_3d(db, parent, kid):
    _runs(db, parent, kid, ["todo", "cancelled", "todo"])
    assert heartbeat.stale_3d(db, DAY) == 1


def test_stale_3d_submitted_breaks(db, parent, kid):
    _runs(db, parent, kid, ["todo", "todo", "todo"], submitted=(1,))
    assert heartbeat.stale_3d(db, DAY) == 0


def test_stale_3d_two_days(db, parent, kid):
    _runs(db, parent, kid, ["todo", "todo"])
    assert heartbeat.stale_3d(db, DAY) == 0


def test_start_off_is_noop():
    app = SimpleNamespace(state=SimpleNamespace())
    hooks.start(app)
    assert not hasattr(app.state, "eval_task")


def test_box_boot_on_start(eval_on, monkeypatch):
    async def noop(*a, **k):
        pass

    monkeypatch.setattr(worker, "run_forever", noop)
    monkeypatch.setattr(listeners, "register", lambda: None)
    app = SimpleNamespace(state=SimpleNamespace())

    async def go():
        hooks.start(app)
        await app.state.eval_task
        hooks.stop(app)

    asyncio.run(go())
    assert [b["payload"]["name"] for b in _rows()] == ["box_boot"]


def test_days_since_install(eval_on, db):
    store.kv_set("first_day", "2026-10-20")
    assert heartbeat.build(db, date(2026, 10, 24))["days_since_install"] == 4
    assert heartbeat.build(db, date(2026, 10, 10))["days_since_install"] == 0


def test_active_days_7_window_edges(eval_on, db):
    for d in ("2026-10-17", "2026-10-18", "2026-10-24", "2026-10-25"):
        store.mark_seen("parent", d)
    store.mark_seen("kid:1", "2026-10-24")
    # window is 10-18..10-24 inclusive: 10-17 and 10-25 excluded, a day counts once
    assert heartbeat.build(db, date(2026, 10, 24))["active_days_7"] == 2


def test_features_used_bitmask(eval_on, db):
    from app.eval.events import AREAS

    order = sorted(AREAS)
    assert heartbeat.FEATURE_ORDER == tuple(order)
    for d, a in (("2026-10-18", "goals"), ("2026-10-24", "reset"), ("2026-10-17", "wifi")):
        store.bump(f"feat:{a}", day=d)
    store.bump("feat:goals", day="2026-10-24")
    want = 1 << order.index("goals") | 1 << order.index("reset")
    assert heartbeat.build(db, date(2026, 10, 24))["features_used_7d"] == want


def test_events_dropped(eval_on, db):
    store.bump("dropped", 3, day="2026-10-24")
    assert heartbeat.build(db, date(2026, 10, 24))["events_dropped"] == 3


def test_build_includes_box_facts(eval_on, db, monkeypatch):
    monkeypatch.setattr(heartbeat.facts, "collect", lambda: {"ram_class": "4G"})
    assert heartbeat.build(db, date(2026, 10, 24))["ram_class"] == "4G"
