"""HomeworkGate tests: pure logic for session follow, name matching, pair expiry and activity tracking."""

from __future__ import annotations

import time

import pytest

from blocker.homework import FOLLOW_SECS, MIN_PAIR_SECS, HomeworkGate


@pytest.fixture
def clock():
    """Fake clock for controlled time advancement."""
    t = [0.0]

    def fake_time():
        return t[0]

    def advance(dt):
        t[0] += dt

    fake_time.advance = advance
    return fake_time


@pytest.fixture
def gate(clock):
    return HomeworkGate(clock=clock)


def test_list_match_allowed_and_starts_window(gate, clock):
    """Allowed name from the list is allowed, and session follow window starts."""
    gate.update({"aa:bb:cc:dd:ee:01": {"allow": ["google.com"], "block": [], "until": "2099-01-01T00:00:00Z"}})
    allowed, via, pulled_by = gate.decide("aa:bb:cc:dd:ee:01", "classroom.google.com")
    assert allowed is True
    assert via == "list"
    assert pulled_by is None


def test_follow_window_within_10s(gate, clock):
    """An unrelated name 5 s later is followed."""
    gate.update({"aa:bb:cc:dd:ee:01": {"allow": ["google.com"], "block": [], "until": "2099-01-01T00:00:00Z"}})
    gate.decide("aa:bb:cc:dd:ee:01", "classroom.google.com")
    clock.advance(5)
    allowed, via, pulled_by = gate.decide("aa:bb:cc:dd:ee:01", "youtube.com")
    assert allowed is True
    assert via == "follow"
    assert pulled_by == "classroom.google.com"


def test_no_follow_after_10s(gate, clock):
    """An unrelated name 11 s later is not followed."""
    gate.update({"aa:bb:cc:dd:ee:01": {"allow": ["google.com"], "block": [], "until": "2099-01-01T00:00:00Z"}})
    gate.decide("aa:bb:cc:dd:ee:01", "classroom.google.com")
    clock.advance(11)
    allowed, via, pulled_by = gate.decide("aa:bb:cc:dd:ee:01", "youtube.com")
    assert allowed is False


def test_follow_window_restarts_on_allowed_lookup(gate, clock):
    """Follow window restarts when a new allowed name is looked up."""
    gate.update({"aa:bb:cc:dd:ee:01": {"allow": ["google.com", "khanacademy.org"], "block": [], "until": "2099-01-01T00:00:00Z"}})
    gate.decide("aa:bb:cc:dd:ee:01", "classroom.google.com")
    clock.advance(8)
    gate.decide("aa:bb:cc:dd:ee:01", "khanacademy.org")  # allowed
    clock.advance(5)
    allowed, via, pulled_by = gate.decide("aa:bb:cc:dd:ee:01", "youtube.com")
    assert allowed is True
    assert via == "follow"
    assert pulled_by == "khanacademy.org"


def test_followed_name_stays_allowed_for_session(gate, clock):
    """A followed name stays allowed for the rest of the session, even after the follow window closes."""
    gate.update({"aa:bb:cc:dd:ee:01": {"allow": ["google.com"], "block": [], "until": "2099-01-01T00:00:00Z"}})
    gate.decide("aa:bb:cc:dd:ee:01", "classroom.google.com")
    clock.advance(5)
    gate.decide("aa:bb:cc:dd:ee:01", "youtube.com")  # followed
    clock.advance(600)
    allowed, via, pulled_by = gate.decide("aa:bb:cc:dd:ee:01", "youtube.com")
    assert allowed is True


def test_block_beats_list(gate, clock):
    """Block list always wins over allow list."""
    gate.update({"aa:bb:cc:dd:ee:01": {"allow": ["google.com"], "block": ["classroom.google.com"], "until": "2099-01-01T00:00:00Z"}})
    allowed, via, pulled_by = gate.decide("aa:bb:cc:dd:ee:01", "classroom.google.com")
    assert allowed is False


def test_block_beats_follow(gate, clock):
    """Block list beats session follow."""
    gate.update({"aa:bb:cc:dd:ee:01": {"allow": ["google.com"], "block": ["youtube.com"], "until": "2099-01-01T00:00:00Z"}})
    gate.decide("aa:bb:cc:dd:ee:01", "classroom.google.com")
    clock.advance(5)
    allowed, via, pulled_by = gate.decide("aa:bb:cc:dd:ee:01", "youtube.com")
    assert allowed is False


def test_subdomain_matching(gate, clock):
    """Subdomains match the list entry."""
    gate.update({"aa:bb:cc:dd:ee:01": {"allow": ["google.com"], "block": [], "until": "2099-01-01T00:00:00Z"}})
    allowed, via, pulled_by = gate.decide("aa:bb:cc:dd:ee:01", "docs.google.com")
    assert allowed is True
    assert via == "list"


def test_pairs_expire_at_max_ttl_300s(gate, clock):
    """Pairs expire at max(TTL, 300s)."""
    gate.update({"aa:bb:cc:dd:ee:01": {"allow": ["google.com"], "block": [], "until": "2099-01-01T00:00:00Z"}})
    gate.decide("aa:bb:cc:dd:ee:01", "classroom.google.com")
    new = gate.record("aa:bb:cc:dd:ee:01", "classroom.google.com", ["8.8.8.8"], ttl=60, via="list", pulled_by=None)
    assert ("aa:bb:cc:dd:ee:01", "8.8.8.8") in gate.pairs()
    clock.advance(300)
    assert ("aa:bb:cc:dd:ee:01", "8.8.8.8") in gate.pairs()
    clock.advance(1)
    assert ("aa:bb:cc:dd:ee:01", "8.8.8.8") not in gate.pairs()


def test_pairs_with_high_ttl(gate, clock):
    """Pairs with high TTL use the TTL, not MIN_PAIR_SECS."""
    gate.update({"aa:bb:cc:dd:ee:01": {"allow": ["google.com"], "block": [], "until": "2099-01-01T00:00:00Z"}})
    gate.decide("aa:bb:cc:dd:ee:01", "classroom.google.com")
    new = gate.record("aa:bb:cc:dd:ee:01", "classroom.google.com", ["8.8.8.8"], ttl=600, via="list", pulled_by=None)
    clock.advance(600)
    assert ("aa:bb:cc:dd:ee:01", "8.8.8.8") in gate.pairs()
    clock.advance(1)
    assert ("aa:bb:cc:dd:ee:01", "8.8.8.8") not in gate.pairs()


def test_lookup_refreshes_pair_expiry(gate, clock):
    """A re-lookup refreshes the pair's expiry time."""
    gate.update({"aa:bb:cc:dd:ee:01": {"allow": ["google.com"], "block": [], "until": "2099-01-01T00:00:00Z"}})
    gate.decide("aa:bb:cc:dd:ee:01", "classroom.google.com")
    gate.record("aa:bb:cc:dd:ee:01", "classroom.google.com", ["8.8.8.8"], ttl=100, via="list", pulled_by=None)
    clock.advance(100)
    gate.record("aa:bb:cc:dd:ee:01", "classroom.google.com", ["8.8.8.8"], ttl=100, via="list", pulled_by=None)
    clock.advance(100)
    assert ("aa:bb:cc:dd:ee:01", "8.8.8.8") in gate.pairs()


def test_update_drops_ended_mac(gate, clock):
    """Removing a MAC from update returns it as ended, and its pairs are gone."""
    gate.update({"aa:bb:cc:dd:ee:01": {"allow": ["google.com"], "block": [], "until": "2099-01-01T00:00:00Z"}})
    gate.decide("aa:bb:cc:dd:ee:01", "classroom.google.com")
    gate.record("aa:bb:cc:dd:ee:01", "classroom.google.com", ["8.8.8.8"], ttl=300, via="list", pulled_by=None)
    assert ("aa:bb:cc:dd:ee:01", "8.8.8.8") in gate.pairs()
    ended = gate.update({})
    assert "aa:bb:cc:dd:ee:01" in ended
    assert ("aa:bb:cc:dd:ee:01", "8.8.8.8") not in gate.pairs()


def test_blocked_cut_keeps_shared_ip(gate, clock):
    """blocked_cut keeps an IP shared with a still-allowed name."""
    gate.update({"aa:bb:cc:dd:ee:01": {"allow": ["google.com", "youtube.com"], "block": [], "until": "2099-01-01T00:00:00Z"}})
    gate.decide("aa:bb:cc:dd:ee:01", "classroom.google.com")
    gate.record("aa:bb:cc:dd:ee:01", "classroom.google.com", ["8.8.8.8"], ttl=300, via="list", pulled_by=None)
    gate.decide("aa:bb:cc:dd:ee:01", "youtube.com")
    gate.record("aa:bb:cc:dd:ee:01", "youtube.com", ["8.8.8.8"], ttl=300, via="list", pulled_by=None)
    # Add youtube to block list
    gate.update({"aa:bb:cc:dd:ee:01": {"allow": ["google.com"], "block": ["youtube.com"], "until": "2099-01-01T00:00:00Z"}})
    cut = gate.blocked_cut("aa:bb:cc:dd:ee:01")
    # 8.8.8.8 is shared with google.com (still allowed), so it's not cut
    assert "8.8.8.8" not in cut


def test_drain_activity_totals(gate, clock):
    """drain_activity returns rows with totals."""
    gate.update({"aa:bb:cc:dd:ee:01": {"allow": ["google.com"], "block": [], "until": "2099-01-01T00:00:00Z"}})
    gate.decide("aa:bb:cc:dd:ee:01", "classroom.google.com")
    gate.record("aa:bb:cc:dd:ee:01", "classroom.google.com", ["8.8.8.8"], ttl=300, via="list", pulled_by=None)
    clock.advance(1)
    gate.decide("aa:bb:cc:dd:ee:01", "classroom.google.com")
    gate.record("aa:bb:cc:dd:ee:01", "classroom.google.com", ["8.8.8.8"], ttl=300, via="list", pulled_by=None)
    activity = gate.drain_activity()
    assert len(activity) == 1
    assert activity[0]["lookups"] >= 2


def test_drain_activity_active_minutes_counts_distinct_minutes(gate, clock):
    """active_minutes counts distinct minutes when lookups happened."""
    gate.update({"aa:bb:cc:dd:ee:01": {"allow": ["google.com"], "block": [], "until": "2099-01-01T00:00:00Z"}})
    gate.decide("aa:bb:cc:dd:ee:01", "classroom.google.com")
    gate.record("aa:bb:cc:dd:ee:01", "classroom.google.com", ["8.8.8.8"], ttl=300, via="list", pulled_by=None)
    clock.advance(30)
    gate.decide("aa:bb:cc:dd:ee:01", "classroom.google.com")
    gate.record("aa:bb:cc:dd:ee:01", "classroom.google.com", ["8.8.8.8"], ttl=300, via="list", pulled_by=None)
    activity = gate.drain_activity()
    assert activity[0]["active_minutes"] >= 1


def test_non_homework_mac_denied(gate, clock):
    """A MAC not in the homework map is denied."""
    gate.update({"aa:bb:cc:dd:ee:01": {"allow": ["google.com"], "block": [], "until": "2099-01-01T00:00:00Z"}})
    allowed, via, pulled_by = gate.decide("aa:bb:cc:dd:ee:02", "google.com")
    assert allowed is False


def test_new_session_returns_new_ips(gate, clock):
    """record returns the newly added IPs."""
    gate.update({"aa:bb:cc:dd:ee:01": {"allow": ["google.com"], "block": [], "until": "2099-01-01T00:00:00Z"}})
    gate.decide("aa:bb:cc:dd:ee:01", "classroom.google.com")
    new = gate.record("aa:bb:cc:dd:ee:01", "classroom.google.com", ["8.8.8.8", "8.8.4.4"], ttl=300, via="list", pulled_by=None)
    assert new == {"8.8.8.8", "8.8.4.4"}
    # Second call with same IP should return empty (not new)
    new2 = gate.record("aa:bb:cc:dd:ee:01", "classroom.google.com", ["8.8.8.8"], ttl=300, via="list", pulled_by=None)
    assert new2 == set()


def test_active_checks_if_mac_in_homework(gate, clock):
    """active returns True only if MAC is in homework mode and session active."""
    gate.update({"aa:bb:cc:dd:ee:01": {"allow": ["google.com"], "block": [], "until": "2099-01-01T00:00:00Z"}})
    assert gate.active("aa:bb:cc:dd:ee:01") is True
    assert gate.active("aa:bb:cc:dd:ee:02") is False
    gate.update({})
    assert gate.active("aa:bb:cc:dd:ee:01") is False
