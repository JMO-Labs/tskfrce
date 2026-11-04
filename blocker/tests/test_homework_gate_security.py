"""HomeworkGate hardening: shared-IP cuts, list normalization, TTL clamp, local `until`."""

from __future__ import annotations

import pytest

from blocker.homework import MAX_PAIR_SECS, MIN_PAIR_SECS, HomeworkGate

MAC = "aa:bb:cc:dd:ee:01"
FUTURE = "2099-01-01T00:00:00Z"


@pytest.fixture
def clock():
    t = [0.0]

    def now():
        return t[0]

    now.advance = lambda dt: t.__setitem__(0, t[0] + dt)
    return now


@pytest.fixture
def wall():
    t = [1_800_000_000.0]  # 2027-01-15

    def now():
        return t[0]

    now.advance = lambda dt: t.__setitem__(0, t[0] + dt)
    return now


@pytest.fixture
def gate(clock, wall):
    return HomeworkGate(clock=clock, wall=wall)


def _hw(allow, block=(), until=FUTURE):
    return {MAC: {"allow": list(allow), "block": list(block), "until": until}}


def _lookup(gate, name, ips, ttl=300):
    allowed, via, pulled = gate.decide(MAC, name)
    assert allowed, name
    return gate.record(MAC, name, ips, ttl, via, pulled)


# --- 1: shared-IP decision survives activity drains -------------------------


def test_blocked_cut_keeps_shared_ip_after_activity_drain(gate):
    gate.update(_hw(["google.com", "youtube.com"]))
    _lookup(gate, "classroom.google.com", ["8.8.8.8"])
    _lookup(gate, "youtube.com", ["8.8.8.8", "9.9.9.9"])
    gate.drain_activity()  # periodic report must not erase what resolved where
    gate.update(_hw(["google.com"], ["youtube.com"]))
    cut = gate.blocked_cut(MAC)
    assert cut == {"9.9.9.9"}
    pairs = gate.pairs()
    assert (MAC, "8.8.8.8") in pairs
    assert (MAC, "9.9.9.9") not in pairs  # cut IPs leave the render set immediately


def test_blocked_cut_ignores_unrelated_allowed_names(gate):
    """An allowed name on a different IP must not shield a blocked-only IP."""
    gate.update(_hw(["google.com", "youtube.com"]))
    _lookup(gate, "classroom.google.com", ["8.8.8.8"])
    _lookup(gate, "youtube.com", ["9.9.9.9"])
    gate.update(_hw(["google.com"], ["youtube.com"]))
    assert gate.blocked_cut(MAC) == {"9.9.9.9"}


def test_blocked_cut_drops_followed_names(gate):
    gate.update(_hw(["google.com"]))
    _lookup(gate, "google.com", ["8.8.8.8"])
    _lookup(gate, "ytimg.com", ["7.7.7.7"])  # followed
    gate.update(_hw(["google.com"], ["ytimg.com"]))
    assert gate.blocked_cut(MAC) == {"7.7.7.7"}
    assert gate.decide(MAC, "ytimg.com")[0] is False


# --- 2: list entries normalized like lookups --------------------------------


def test_update_normalizes_list_entries(gate):
    gate.update(_hw([" Google.COM. ", "", "  "], [" YouTube.com. "]))
    assert gate.decide(MAC, "classroom.google.com")[0] is True
    assert gate.decide(MAC, "www.youtube.com")[0] is False


def test_empty_block_entry_does_not_block_everything(gate):
    gate.update(_hw(["google.com"], [""]))
    assert gate.decide(MAC, "google.com")[0] is True


# --- 3: pair expiry clamped to [MIN, MAX] -----------------------------------


def test_pair_expiry_clamped_to_max(gate, clock):
    gate.update(_hw(["google.com"]))
    _lookup(gate, "google.com", ["8.8.8.8"], ttl=86400 * 7)
    clock.advance(MAX_PAIR_SECS)
    assert (MAC, "8.8.8.8") in gate.pairs()
    clock.advance(1)
    assert (MAC, "8.8.8.8") not in gate.pairs()


def test_pair_expiry_min_and_ttl_reported(gate):
    gate.update(_hw(["google.com"]))
    _lookup(gate, "google.com", ["8.8.8.8"], ttl=0)
    assert gate.pairs_ttl() == {(MAC, "8.8.8.8"): MIN_PAIR_SECS}
    assert gate.remaining(MAC, ["8.8.8.8", "1.1.1.1"]) == {"8.8.8.8": MIN_PAIR_SECS}


# --- 12: `until` enforced locally --------------------------------------------


def test_session_past_until_is_inactive_without_backend(gate, wall):
    until = "2027-01-15T08:10:00Z"  # wall starts 08:00:00Z
    gate.update(_hw(["google.com"], until=until))
    _lookup(gate, "google.com", ["8.8.8.8"])
    assert gate.active(MAC)
    wall.advance(600)
    assert not gate.active(MAC)
    assert gate.decide(MAC, "google.com")[0] is False
    assert gate.pairs() == set()
    assert gate.expire() == {MAC}
    assert gate.macs() == []


def test_update_skips_expired_or_unparseable_until(gate):
    assert gate.update(_hw(["google.com"], until="2020-01-01T00:00:00Z")) == set()
    assert not gate.active(MAC)
    gate.update(_hw(["google.com"], until="not-a-date"))
    assert not gate.active(MAC)
    gate.update(_hw(["google.com"], until="2099-01-01T00:00:00"))  # naive: ambiguous
    assert not gate.active(MAC)


def test_update_ends_session_when_until_moves_into_past(gate):
    gate.update(_hw(["google.com"]))
    assert gate.update(_hw(["google.com"], until="2020-01-01T00:00:00Z")) == {MAC}


def test_session_start_is_stable_across_drains(gate, clock):
    gate.update(_hw(["google.com"]))
    _lookup(gate, "google.com", ["8.8.8.8"])
    first = gate.drain_activity()[0]["session_start"]
    clock.advance(120)
    _lookup(gate, "google.com", ["8.8.8.8"])
    assert gate.drain_activity()[0]["session_start"] == first
