"""HomeworkGate: pure logic for session follow, name matching, pair expiry and activity tracking."""

from __future__ import annotations

import time
from dataclasses import dataclass, field

FOLLOW_SECS = 10.0
MIN_PAIR_SECS = 300


def domain_matches(name: str, entry: str) -> bool:
    """Return True if name matches entry (exact match or subdomain)."""
    if name == entry:
        return True
    return name.endswith("." + entry)


@dataclass
class _Session:
    """Per-MAC homework session state."""

    mac: str
    allow: set[str]
    block: set[str]
    until: str
    last_allowed_time: float
    last_allowed_name: str | None = None
    followed_names: set[str] = field(default_factory=set)
    pairs: dict[str, float] = field(default_factory=dict)  # {ip: expiry_time}
    activity: dict[str, _Activity] = field(default_factory=dict)  # {domain: _Activity}


@dataclass
class _Activity:
    """Per-domain activity within a session."""

    domain: str
    via: str  # 'list' or 'follow'
    pulled_by: str | None
    first_seen: float
    last_seen: float
    lookups: int
    active_minutes: set[int]  # Set of minute offsets from session start


class HomeworkGate:
    """Decides per DNS name: allow, follow, or block. Tracks pairs and activity."""

    def __init__(self, clock=time.monotonic):
        self._clock = clock
        self._sessions: dict[str, _Session] = {}

    def update(self, state: dict[str, dict]) -> set[str]:
        """Update the homework state; return MACs whose sessions ended.

        state: dict mapping MAC to {allow: [names], block: [names], until: ts}
        """
        ended = set()
        for mac in list(self._sessions.keys()):
            if mac not in state:
                ended.add(mac)
                del self._sessions[mac]
        for mac, hw in state.items():
            if mac not in self._sessions:
                now = self._clock()
                self._sessions[mac] = _Session(
                    mac=mac,
                    allow=set(hw["allow"]),
                    block=set(hw["block"]),
                    until=hw["until"],
                    last_allowed_time=now,
                )
            else:
                self._sessions[mac].allow = set(hw["allow"])
                self._sessions[mac].block = set(hw["block"])
                self._sessions[mac].until = hw["until"]
        return ended

    def decide(self, mac: str, name: str) -> tuple[bool, str | None, str | None]:
        """Decide if a name is allowed for this MAC.

        Returns (allowed, via, pulled_by):
        - via: "list" (in allow list), "follow" (from session follow), or None (denied)
        - pulled_by: name that this was followed from, or None
        """
        name = name.lower().rstrip(".")
        sess = self._sessions.get(mac)
        if sess is None:
            return False, None, None

        # Block list always wins
        for block_entry in sess.block:
            if domain_matches(name, block_entry):
                return False, None, None

        # Check allow list
        for allow_entry in sess.allow:
            if domain_matches(name, allow_entry):
                sess.last_allowed_time = self._clock()
                sess.last_allowed_name = name
                return True, "list", None

        # Check session follow: name is allowed if it was already followed, or within follow window of last allowed lookup
        now = self._clock()
        if name in sess.followed_names:
            # Already followed in this session, stays allowed
            return True, "follow", None
        if sess.last_allowed_name and (now - sess.last_allowed_time) < FOLLOW_SECS:
            # Within follow window, mark this name as followed
            sess.followed_names.add(name)
            return True, "follow", sess.last_allowed_name

        return False, None, None

    def record(self, mac: str, name: str, ips: list[str], ttl: int, via: str, pulled_by: str | None) -> set[str]:
        """Record a lookup and add/refresh pairs; return newly added IPs."""
        name = name.lower().rstrip(".")
        sess = self._sessions.get(mac)
        if sess is None:
            return set()

        # Record activity
        now = self._clock()
        minute_bucket = int(now) // 60
        if name not in sess.activity:
            sess.activity[name] = _Activity(
                domain=name,
                via=via,
                pulled_by=pulled_by,
                first_seen=now,
                last_seen=now,
                lookups=1,
                active_minutes={minute_bucket},
            )
        else:
            act = sess.activity[name]
            act.last_seen = now
            act.lookups += 1
            act.active_minutes.add(minute_bucket)

        # Track followed names
        if via == "follow":
            sess.followed_names.add(name)

        # Add/refresh pairs
        expiry = now + max(ttl, MIN_PAIR_SECS)
        new_ips = set()
        for ip in ips:
            if ip not in sess.pairs:
                new_ips.add(ip)
            sess.pairs[ip] = expiry

        return new_ips

    def pairs(self) -> set[tuple[str, str]]:
        """Return unexpired (mac, ip) pairs."""
        now = self._clock()
        result = set()
        for mac, sess in self._sessions.items():
            for ip, expiry in sess.pairs.items():
                if expiry >= now:
                    result.add((mac, ip))
        return result

    def blocked_cut(self, mac: str) -> set[str]:
        """IPs to remove after the block list changed (only IPs resolved by now-blocked names)."""
        sess = self._sessions.get(mac)
        if sess is None:
            return set()

        now = self._clock()
        # Find all names that match the block list
        blocked_names = set()
        for activity in sess.activity.values():
            for block_entry in sess.block:
                if domain_matches(activity.domain, block_entry):
                    blocked_names.add(activity.domain)
                    break

        # Find IPs that ONLY resolve to blocked names
        ips_to_cut = set()
        for ip in list(sess.pairs.keys()):
            if sess.pairs[ip] <= now:
                continue  # Already expired
            # Check if any non-blocked allowed name resolves to this IP
            ip_is_shared = False
            for activity in sess.activity.values():
                if activity.domain not in blocked_names:
                    # This activity is still allowed
                    ip_is_shared = True
                    break
            if not ip_is_shared:
                ips_to_cut.add(ip)

        return ips_to_cut

    def drain_activity(self) -> list[dict]:
        """Return activity rows and clear them."""
        now = self._clock()
        result = []
        for mac, sess in self._sessions.items():
            for activity in sess.activity.values():
                session_start = min(a.first_seen for a in sess.activity.values()) if sess.activity else now
                result.append(
                    {
                        "mac": mac,
                        "session_start": time.gmtime(session_start)[:6],  # Will be formatted by caller
                        "domain": activity.domain,
                        "via": activity.via,
                        "pulled_by": activity.pulled_by,
                        "first_seen": activity.first_seen,
                        "last_seen": activity.last_seen,
                        "lookups": activity.lookups,
                        "active_minutes": len(activity.active_minutes),
                    }
                )
        # Clear activity
        for sess in self._sessions.values():
            sess.activity.clear()
        return result

    def active(self, mac: str) -> bool:
        """Return True if MAC is in an active homework session."""
        return mac in self._sessions
