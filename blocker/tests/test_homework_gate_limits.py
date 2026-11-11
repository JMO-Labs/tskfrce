"""HomeworkGate limits: per-session name cap and pair timeouts bounded by ``until``."""

from __future__ import annotations

import logging
from datetime import UTC, datetime

import pytest
from blocker import homework
from blocker.homework import HomeworkGate

MAC = "aa:bb:cc:dd:ee:02"
FUTURE = "2099-01-01T00:00:00Z"


@pytest.fixture
def wall():
    t = [1_800_000_000.0]
    return lambda: t[0]


@pytest.fixture
def gate(wall):
    t = [0.0]
    return HomeworkGate(clock=lambda: t[0], wall=wall)


def _hw(allow, until=FUTURE):
    return {MAC: {"allow": list(allow), "block": [], "until": until}}


def _lookup(gate, name, ips=("1.1.1.1",)):
    allowed, via, pulled = gate.decide(MAC, name)
    if allowed:
        gate.record(MAC, name, list(ips), 300, via, pulled)
    return allowed


# --- name cap ---------------------------------------------------------------


@pytest.fixture
def capped(gate, monkeypatch):
    monkeypatch.setattr(homework, "MAX_NAMES", 3)
    gate.update(_hw(["school.org"]))
    assert _lookup(gate, "a.school.org")
    assert _lookup(gate, "cdn.example.com")  # followed from a.school.org
    assert _lookup(gate, "b.school.org")  # 3 names: at the cap
    return gate


def test_cap_stops_new_follows(capped):
    assert not capped.decide(MAC, "tracker.example.net")[0]


def test_cap_keeps_known_and_listed_names(capped):
    assert capped.decide(MAC, "cdn.example.com")[0]  # already followed
    assert _lookup(capped, "c.school.org", ["9.9.9.9"])  # listed: still answered
    assert any(ip == "9.9.9.9" for _, ip in capped.pairs())


def test_cap_stops_new_activity(capped):
    _lookup(capped, "c.school.org")
    _lookup(capped, "d.school.org")
    domains = {r["domain"] for r in capped.drain_activity()}
    assert domains == {"a.school.org", "cdn.example.com", "b.school.org"}


def test_cap_bounds_ip_names_and_keeps_cut_working(capped):
    for i in range(10):
        _lookup(capped, f"n{i}.school.org", [f"10.0.0.{i}"])
    sess = capped._sessions[MAC]
    assert sum(len(n) for n in sess.ip_names.values()) <= 3 + 10
    capped.update({MAC: {"allow": [], "block": [], "until": FUTURE}})
    assert "10.0.0.5" in capped.blocked_cut(MAC)  # de-listing still cuts capped IPs


def test_cap_logs_once(capped, caplog):
    with caplog.at_level(logging.WARNING, logger="blocker.homework"):
        capped.decide(MAC, "x.example.net")
        capped.decide(MAC, "y.example.net")
        _lookup(capped, "e.school.org")
    assert sum("name cap" in r.getMessage() for r in caplog.records) == 1


# --- pair timeouts never outlive the session --------------------------------


def _until(wall, secs):
    return datetime.fromtimestamp(wall() + secs, UTC).isoformat()


def test_pair_timeout_bounded_by_until(gate, wall):
    gate.update(_hw(["school.org"], until=_until(wall, 100)))
    _lookup(gate, "school.org", ["8.8.8.8"])
    assert gate.pairs_ttl() == {(MAC, "8.8.8.8"): 100}
    assert gate.remaining(MAC, ["8.8.8.8"]) == {"8.8.8.8": 100}


def test_pair_timeout_floor_one_second(gate, wall):
    gate.update(_hw(["school.org"], until=_until(wall, 0.4)))
    _lookup(gate, "school.org", ["8.8.8.8"])
    assert gate.pairs_ttl() == {(MAC, "8.8.8.8"): 1}
    assert gate.remaining(MAC, ["8.8.8.8"]) == {"8.8.8.8": 1}


def test_cap_then_blocking_resolved_subdomain_cuts_its_ips(capped):
    """Past the cap, blocking a subdomain that already resolved must still cut its IPs."""
    _lookup(capped, "video.school.org", ["7.7.7.7"])  # capped: tracked under the entry
    capped.update({MAC: {"allow": ["school.org"], "block": ["video.school.org"], "until": FUTURE}})
    assert "7.7.7.7" in capped.blocked_cut(MAC)
    assert not any(ip == "7.7.7.7" for _, ip in capped.pairs())
