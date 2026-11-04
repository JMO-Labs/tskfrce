"""HomeworkGate: pure logic for session follow, name matching, pair expiry and activity tracking."""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from datetime import datetime

FOLLOW_SECS = 10.0
MIN_PAIR_SECS = 300
MAX_PAIR_SECS = 3600  # a long upstream TTL must not keep a hole open for days


def norm_name(name: str) -> str:
    """Canonical DNS name form shared by lists and lookups."""
    return str(name).strip().lower().rstrip(".")


def norm_names(names) -> set[str]:
    return {n for n in (norm_name(x) for x in names) if n}


def parse_until(until) -> float | None:
    """ISO timestamp (``Z`` or offset) -> epoch seconds; None if unparseable."""
    try:
        dt = datetime.fromisoformat(str(until))
    except (TypeError, ValueError):
        return None
    if dt.tzinfo is None:
        return None
    return dt.timestamp()


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
    until: float
    last_allowed_time: float
    started_wall: float = 0.0
    last_allowed_name: str | None = None
    followed_names: dict[str, str] = field(default_factory=dict)  # {name: list name it followed}
    pairs: dict[str, float] = field(default_factory=dict)  # {ip: expiry_time}
    # {ip: names that resolved to it}; persists across activity drains (shared-IP cuts)
    ip_names: dict[str, set[str]] = field(default_factory=dict)
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


def _listed(sess: _Session, name: str) -> bool:
    return not any(domain_matches(name, b) for b in sess.block) and any(
        domain_matches(name, a) for a in sess.allow
    )


def _still_allowed(sess: _Session, name: str) -> bool:
    """Would this name still be allowed under the current lists (follow window aside)?"""
    if any(domain_matches(name, b) for b in sess.block):
        return False
    if any(domain_matches(name, a) for a in sess.allow):
        return True
    return name in sess.followed_names  # pruned to live parents by _prune_follow


def _prune_follow(sess: _Session) -> None:
    """Forget follows whose parent left the list (or got blocked) and blocked follows."""
    sess.followed_names = {
        n: parent
        for n, parent in sess.followed_names.items()
        if _listed(sess, parent) and not any(domain_matches(n, b) for b in sess.block)
    }
    if sess.last_allowed_name and not _listed(sess, sess.last_allowed_name):
        sess.last_allowed_name = None


class HomeworkGate:
    """Decides per DNS name: allow, follow, or block. Tracks pairs and activity.

    Thread-safe: the DNS worker pool, the API push and the render path all touch it.
    ``clock`` (monotonic) drives pairs and follow; ``wall`` (epoch) drives ``until``.
    """

    def __init__(self, clock=time.monotonic, wall=time.time):
        self._clock = clock
        self._wall = wall
        self._lock = threading.RLock()
        self._sessions: dict[str, _Session] = {}

    def _live(self, mac: str | None) -> _Session | None:
        """Session for mac unless missing or past its ``until`` (enforced locally)."""
        sess = self._sessions.get(mac) if mac else None
        if sess is None or self._wall() >= sess.until:
            return None
        return sess

    def update(self, state: dict[str, dict]) -> set[str]:
        """Update the homework state; return MACs whose sessions ended.

        state: dict mapping MAC to {allow: [names], block: [names], until: ts}.
        A session whose ``until`` is past or unparseable is treated as absent.
        """
        with self._lock:
            now_wall = self._wall()
            wanted: dict[str, tuple[set[str], set[str], float]] = {}
            for mac, hw in state.items():
                until = parse_until(hw.get("until"))
                if until is None or until <= now_wall:
                    continue
                wanted[mac] = (
                    norm_names(hw.get("allow", [])),
                    norm_names(hw.get("block", [])),
                    until,
                )
            ended = {mac for mac in self._sessions if mac not in wanted}
            for mac in ended:
                del self._sessions[mac]
            for mac, (allow, block, until) in wanted.items():
                sess = self._sessions.get(mac)
                if sess is None:
                    self._sessions[mac] = _Session(
                        mac=mac,
                        allow=allow,
                        block=block,
                        until=until,
                        last_allowed_time=self._clock(),
                        started_wall=now_wall,
                    )
                else:
                    sess.allow, sess.block, sess.until = allow, block, until
                    _prune_follow(sess)
            return ended

    def expire(self) -> set[str]:
        """End sessions past ``until`` (works with the backend down); return their MACs."""
        with self._lock:
            now_wall = self._wall()
            ended = {mac for mac, s in self._sessions.items() if now_wall >= s.until}
            for mac in ended:
                del self._sessions[mac]
            return ended

    def decide(self, mac: str, name: str) -> tuple[bool, str | None, str | None]:
        """Decide if a name is allowed for this MAC.

        Returns (allowed, via, pulled_by):
        - via: "list" (in allow list), "follow" (from session follow), or None (denied)
        - pulled_by: name that this was followed from, or None
        """
        name = norm_name(name)
        with self._lock:
            sess = self._live(mac)
            if sess is None or not name:
                return False, None, None

            # Block list always wins
            if any(domain_matches(name, b) for b in sess.block):
                return False, None, None

            now = self._clock()
            if any(domain_matches(name, a) for a in sess.allow):
                sess.last_allowed_time = now
                sess.last_allowed_name = name
                return True, "list", None

            # Session follow: already followed, or within the window of the last allowed lookup
            if name in sess.followed_names:
                return True, "follow", None
            if sess.last_allowed_name and (now - sess.last_allowed_time) < FOLLOW_SECS:
                sess.followed_names[name] = sess.last_allowed_name
                return True, "follow", sess.last_allowed_name

            return False, None, None

    def record(
        self, mac: str, name: str, ips: list[str], ttl: int, via: str, pulled_by: str | None
    ) -> set[str]:
        """Record a lookup and add/refresh pairs; return newly added IPs."""
        name = norm_name(name)
        with self._lock:
            sess = self._live(mac)
            if sess is None:
                return set()

            now = self._clock()
            minute_bucket = int(now) // 60
            act = sess.activity.get(name)
            if act is None:
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
                act.last_seen = now
                act.lookups += 1
                act.active_minutes.add(minute_bucket)

            if via == "follow" and pulled_by:
                sess.followed_names.setdefault(name, norm_name(pulled_by))

            expiry = now + min(max(int(ttl), MIN_PAIR_SECS), MAX_PAIR_SECS)
            new_ips = set()
            for ip in ips:
                if ip not in sess.pairs or sess.pairs[ip] < now:
                    new_ips.add(ip)
                sess.pairs[ip] = max(expiry, sess.pairs.get(ip, 0.0))
                sess.ip_names.setdefault(ip, set()).add(name)
            return new_ips

    def remaining(self, mac: str, ips) -> dict[str, int]:
        """Seconds each live pair of mac has left (firewall element timeouts)."""
        with self._lock:
            sess = self._live(mac)
            if sess is None:
                return {}
            now = self._clock()
            return {
                ip: max(1, int(sess.pairs[ip] - now))
                for ip in ips
                if ip in sess.pairs and sess.pairs[ip] >= now
            }

    def pairs_ttl(self) -> dict[tuple[str, str], int]:
        """Unexpired {(mac, ip): seconds_left} for live sessions."""
        with self._lock:
            now = self._clock()
            out: dict[tuple[str, str], int] = {}
            for mac in list(self._sessions):
                sess = self._live(mac)
                if sess is None:
                    continue
                for ip, expiry in sess.pairs.items():
                    if expiry >= now:
                        out[(mac, ip)] = max(1, int(expiry - now))
            return out

    def pairs(self) -> set[tuple[str, str]]:
        """Return unexpired (mac, ip) pairs."""
        return set(self.pairs_ttl())

    def blocked_cut(self, mac: str) -> set[str]:
        """Drop and return IPs no still-allowed name resolved to (after a list change).

        Uses the persistent ip->names map (not drained activity): an IP stays while any
        name that resolved to it is still allowed (list match, or a follow whose parent
        is still on the list); blocked, de-listed and orphaned-follow names don't count.
        """
        with self._lock:
            sess = self._sessions.get(mac)
            if sess is None:
                return set()
            _prune_follow(sess)
            cut = {
                ip
                for ip, names in sess.ip_names.items()
                if not any(_still_allowed(sess, n) for n in names)
            }
            for ip in cut:
                sess.pairs.pop(ip, None)
                del sess.ip_names[ip]
            return cut

    def drain_activity(self) -> list[dict]:
        """Return activity rows and clear them."""
        with self._lock:
            result = []
            for mac, sess in self._sessions.items():
                for activity in sess.activity.values():
                    result.append(
                        {
                            "mac": mac,
                            # stable per session so the backend upserts one row per domain
                            "session_start": time.gmtime(sess.started_wall)[:6],
                            "domain": activity.domain,
                            "via": activity.via,
                            "pulled_by": activity.pulled_by,
                            "first_seen": activity.first_seen,
                            "last_seen": activity.last_seen,
                            "lookups": activity.lookups,
                            "active_minutes": len(activity.active_minutes),
                        }
                    )
                sess.activity.clear()
            return result

    def macs(self) -> list[str]:
        """MACs with a live session."""
        with self._lock:
            return [m for m in self._sessions if self._live(m) is not None]

    def active(self, mac: str | None) -> bool:
        """Return True if MAC is in an active (not past ``until``) homework session."""
        with self._lock:
            return self._live(mac) is not None
