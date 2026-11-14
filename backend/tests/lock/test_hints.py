from datetime import datetime, timedelta

from app.lock.hints import DeviceSignals, find_hint

NOW = datetime(2026, 10, 24, 12, 0)
FIRST = NOW - timedelta(minutes=1)  # new device first_seen


def sig(i, *, mac="aa:00:00:00:00:01", seen_ago=timedelta(minutes=10), owners=(1,), **kw):
    return DeviceSignals(
        id=i,
        mac=mac,
        first_seen=kw.pop("first_seen", NOW - timedelta(days=30)),
        last_seen=FIRST - seen_ago,
        owner_ids=frozenset(owners),
        **kw,
    )


def new(**kw):
    return DeviceSignals(
        id=99,
        mac=kw.pop("mac", "02:00:00:00:00:99"),
        first_seen=FIRST,
        last_seen=NOW,
        owner_ids=frozenset(),
        **kw,
    )


def run(n, cands, paused=()):
    return find_hint(n, cands, NOW, set(paused))


def test_strong_name_case_insensitive():
    h = run(new(mdns_name="Bobbys-iPad"), [sig(1, mdns_name="bobbys-ipad")])
    assert (h.candidate_id, h.reason) == (1, "name")


def test_dhcp_hostname_matches_like_name():
    h = run(new(hostname="Bobby-Laptop"), [sig(1, hostname="bobby-laptop")])
    assert (h.candidate_id, h.reason) == (1, "name")


def test_empty_name_never_matches():
    assert run(new(mdns_name=""), [sig(1, mdns_name="")]) is None
    assert run(new(), [sig(1)]) is None


def test_medium_model_and_fp():
    h = run(new(model="iPad13,1", dhcp_fp="1,3"), [sig(1, model="iPad13,1", dhcp_fp="1,3")])
    assert (h.candidate_id, h.reason) == (1, "model")


def test_medium_needs_both():
    assert run(new(model="m", dhcp_fp="1"), [sig(1, model="m", dhcp_fp="2")]) is None
    assert run(new(model="m"), [sig(1, model="m")]) is None
    assert run(new(model="", dhcp_fp=""), [sig(1, model="", dhcp_fp="")]) is None


def test_weak_needs_everything():
    c = sig(1, dhcp_fp="1,3", seen_ago=timedelta(minutes=10))
    h = run(new(dhcp_fp="1,3"), [c], paused={1})
    assert (h.candidate_id, h.reason) == (1, "timing")
    assert run(new(dhcp_fp="1,3"), [c], paused=()) is None  # not paused
    assert run(new(dhcp_fp="1,3", mac="00:00:00:00:00:99"), [c], paused={1}) is None  # not random
    assert run(new(dhcp_fp="1,4"), [c], paused={1}) is None  # other fp
    assert run(new(), [sig(1)], paused={1}) is None  # no fp
    old = sig(1, dhcp_fp="1,3", seen_ago=timedelta(minutes=31))
    assert run(new(dhcp_fp="1,3"), [old], paused={1}) is None  # >30 min
    edge = sig(1, dhcp_fp="1,3", seen_ago=timedelta(minutes=30))
    assert run(new(dhcp_fp="1,3"), [edge], paused={1}) is not None


def test_overlap_excluded():
    c = sig(1, mdns_name="x", seen_ago=timedelta(minutes=1))  # seen 1 min before first_seen
    assert run(new(mdns_name="x"), [c]) is None
    after = sig(1, mdns_name="x", seen_ago=timedelta(minutes=-1))  # seen after new appeared
    assert run(new(mdns_name="x"), [after]) is None
    ok = sig(1, mdns_name="x", seen_ago=timedelta(minutes=2, seconds=1))
    assert run(new(mdns_name="x"), [ok]) is not None


def test_24h_window():
    ok = sig(1, mdns_name="x", seen_ago=timedelta(hours=22))
    assert run(new(mdns_name="x"), [ok]) is not None
    old = sig(1, mdns_name="x", seen_ago=timedelta(hours=24, minutes=5))
    assert run(new(mdns_name="x"), [old]) is None


def test_never_seen_or_self():
    c = DeviceSignals(
        id=1,
        mac="aa:00:00:00:00:01",
        first_seen=NOW,
        last_seen=None,
        owner_ids=frozenset({1}),
        mdns_name="x",
    )
    assert run(new(mdns_name="x"), [c]) is None
    me = sig(99, mdns_name="x")
    assert run(new(mdns_name="x"), [me]) is None


def test_best_strength_wins():
    strong = sig(1, mdns_name="x", owners=(1,), seen_ago=timedelta(hours=5))
    medium = sig(2, model="m", dhcp_fp="1", owners=(2,), seen_ago=timedelta(minutes=10))
    h = run(new(mdns_name="x", model="m", dhcp_fp="1"), [medium, strong])
    assert (h.candidate_id, h.reason) == (1, "name")


def test_tie_same_owners_most_recent():
    a = sig(1, mdns_name="x", seen_ago=timedelta(hours=3))
    b = sig(2, mdns_name="x", seen_ago=timedelta(hours=1))
    assert run(new(mdns_name="x"), [a, b]).candidate_id == 2


def test_tie_different_owners_ambiguous():
    a = sig(1, mdns_name="x", owners=(1,), seen_ago=timedelta(hours=3))
    b = sig(2, mdns_name="x", owners=(2,), seen_ago=timedelta(hours=1))
    assert run(new(mdns_name="x"), [a, b]) is None


def test_weaker_tie_does_not_block_stronger():
    a = sig(1, mdns_name="x", owners=(1,))
    b = sig(2, model="m", dhcp_fp="1", owners=(2,))
    assert run(new(mdns_name="x", model="m", dhcp_fp="1"), [a, b]).candidate_id == 1


def test_rejected_excluded():
    a = sig(1, mdns_name="x")
    assert find_hint(new(mdns_name="x"), [a], NOW, set(), rejected={1}) is None
    b = sig(2, mdns_name="x", seen_ago=timedelta(hours=9))
    assert find_hint(new(mdns_name="x"), [a, b], NOW, set(), rejected={1}).candidate_id == 2
