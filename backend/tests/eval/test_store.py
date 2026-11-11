import uuid
from datetime import UTC, datetime

from app.eval import store


def test_household_is_stable(eval_on):
    a = store.household()
    assert a == store.household()
    uuid.UUID(a)


def test_once(eval_on):
    assert store.once("k") is True
    assert store.once("k") is False


def test_bump_and_counters(eval_on):
    today = store.local_day()
    store.bump("chores_done")
    store.bump("chores_done")
    store.bump("manual_locks", day="2026-10-24")
    assert store.counters(today)["chores_done"] == 2
    assert store.counters("2026-10-24") == {"manual_locks": 1}


def test_seen_counts(eval_on):
    for w in ("parent", "parent", "kid:3", "kid:4"):
        store.mark_seen(w, "2026-10-25")
    assert store.seen_counts("2026-10-25") == (1, 2)


def test_kid_age_default(eval_on):
    assert store.kid_age(9) == "unknown"
    assert store.kid_age(None) == "unknown"
    store.set_kid_age(9, "8–10")
    assert store.kid_age(9) == "8–10"


def test_local_day_uses_family_tz(eval_on):
    now = datetime(2026, 10, 25, 3, 30, tzinfo=UTC)
    store.set_tz("America/New_York")
    assert store.local_day(now) == "2026-10-24"
    assert store.local_day(now, days_back=1) == "2026-10-23"
    store.set_tz("Not/AZone")
    assert store.local_day(now) == "2026-10-25"


def test_outbox_backoff(eval_on):
    store.enqueue("umami", {"a": 1}, now=1000)
    rows = store.due(1000)
    assert len(rows) == 1 and rows[0].body == {"a": 1}
    store.failed(rows[0].id, 1, 1000)
    assert store.due(1100) == []
    assert len(store.due(1121)) == 1
    store.sent(rows[0].id)
    assert store.due(10**9) == []


def test_prune_age(eval_on):
    store.enqueue("umami", {}, now=0)
    store.enqueue("feedback", {}, now=0)
    assert store.prune(15 * 86400) == 1
    assert [r.kind for r in store.due(15 * 86400)] == ["feedback"]


def test_daily_cap_drops_incoming_and_counts(eval_on):
    for i in range(store.DAILY_CAP + 3):
        store.enqueue("umami", {"i": i}, now=1000.0 + i)
    rows = store.due(10**9, limit=10_000)
    assert len(rows) == store.DAILY_CAP
    assert rows[-1].body == {"i": store.DAILY_CAP - 1}
    assert store.counters(store.local_day())["dropped"] == 3


def test_cap_holds_after_outbox_drained(eval_on):
    sent = 0
    for i in range(store.DAILY_CAP + 50):
        store.enqueue("umami", {"i": i}, now=1000.0 + i)
        for r in store.due(10**9):
            store.sent(r.id)
            sent += 1
    assert sent == store.DAILY_CAP
    assert store.counters(store.local_day())["dropped"] == 50


def test_uncapped_enqueue_bypasses_cap(eval_on):
    for i in range(store.DAILY_CAP):
        store.enqueue("umami", {"i": i})
    store.enqueue("umami", {"hb": 1}, capped=False)
    rows = store.due(10**10, limit=10_000)
    assert len(rows) == store.DAILY_CAP + 1 and rows[-1].body == {"hb": 1}
    assert store.counters(store.local_day()).get("dropped", 0) == 0


def test_cap_ignores_non_umami(eval_on):
    for i in range(store.DAILY_CAP + 2):
        store.enqueue("feedback", {"i": i})
    assert len(store.due(10**10, limit=10_000)) == store.DAILY_CAP + 2
