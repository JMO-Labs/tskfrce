"""Upstream DNS forwarding for homework mode."""

from __future__ import annotations

import ipaddress
import logging
import socket
import time

log = logging.getLogger(__name__)


def _question(wire: bytes, qr: int) -> tuple[int, str, int, int] | None:
    """(txid, qname, qtype, qclass) of a single-question message with the given QR bit."""
    from scapy.layers.dns import DNS

    try:
        msg = DNS(wire)
        if msg.qr != qr or msg.qdcount != 1 or not msg.qd:
            return None
        q = msg.qd[0]
        return msg.id, _name(q.qname), int(q.qtype), int(q.qclass)
    except Exception:  # noqa: BLE001 - any malformed packet is just "no match"
        return None


def _name(raw) -> str:
    if isinstance(raw, bytes):
        raw = raw.decode("ascii", "replace")
    return str(raw).lower().rstrip(".")


def forward(query: bytes, server: str, timeout: float = 2.0, port: int = 53) -> bytes | None:
    """Ask the upstream resolver; return its reply or None on timeout/error.

    The socket is connected, so the kernel drops datagrams not from (server, port); the
    source port is OS-random. A reply is accepted only if its txid and question
    (qname/qtype/qclass) match the query; anything else is discarded until the deadline.
    """
    want = _question(query, qr=0) if server else None
    if want is None:
        return None
    deadline = time.monotonic() + timeout
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect((server, port))
            sock.send(query)
            while (left := deadline - time.monotonic()) > 0:
                sock.settimeout(left)
                reply = sock.recv(4096)
                if _question(reply, qr=1) == want:
                    return reply
                log.debug("discarding mismatched upstream DNS reply")
    except OSError:  # includes timeout
        return None
    return None


def a_records(reply: bytes, qname: str | None = None) -> tuple[list[str], int]:
    """IPv4 addresses and minimum TTL from a DNS reply.

    Only A records owned by qname or by a name on qname's CNAME chain (within this answer)
    count, so an upstream can't smuggle pairs for unrelated names. When qname is given the
    reply's question must be qname. TTL defaults to 3600 only alongside an empty result.
    """
    from scapy.layers.dns import DNS

    try:
        resp = DNS(reply)
        if resp.qr != 1 or resp.qdcount != 1 or not resp.qd:
            return [], 0
        asked = _name(resp.qd[0].qname)
        if qname is not None and asked != _name(qname):
            return [], 0
        rrs = list(resp.an or [])
        chain = {asked}
        grew = True
        while grew:  # follow CNAMEs in any order, bounded by the answer size
            grew = False
            for rr in rrs:
                if rr.type == 5 and _name(rr.rrname) in chain:
                    target = _name(rr.rdata)
                    if target not in chain:
                        chain.add(target)
                        grew = True
        ips: list[str] = []
        ttl = 3600
        for rr in rrs:
            if rr.type == 1 and _name(rr.rrname) in chain:
                ips.append(str(ipaddress.IPv4Address(rr.rdata)))
                ttl = min(ttl, int(rr.ttl))
        return ips, ttl
    except Exception:
        log.debug("failed to parse DNS reply", exc_info=True)
        return [], 0


def servfail(query: bytes) -> bytes | None:
    """Return a SERVFAIL response for a query."""
    from scapy.layers.dns import DNS

    try:
        q = DNS(query)
        resp = DNS(id=q.id, qr=1, rcode=2)  # rcode 2 = SERVFAIL
        return bytes(resp)
    except Exception:
        log.debug("failed to build SERVFAIL", exc_info=True)
        return None


def handle_homework(
    gate, firewall_add, mac_for_ip, server: str, client_ip: str, query: bytes
) -> bytes | None:
    """DNS handle for homework mode: forward allowed queries, record pairs, pre-install in firewall.

    Returns the reply bytes if allowed and forwarded, None to fall back to portal.
    """
    from scapy.layers.dns import DNS

    try:
        # Parse the query
        q = DNS(query)
        if q.qr != 0 or q.opcode != 0 or q.qdcount != 1:
            return None
        qname = _name(q.qd[0].qname)
        qtype = q.qd[0].qtype
    except Exception:  # noqa: BLE001 - unparsable query falls back to the portal
        return None

    # Get MAC from IP
    mac = mac_for_ip(client_ip)
    if not gate.active(mac):
        return None

    # AAAA queries always get portal answer
    if qtype == 28:  # AAAA
        return None

    # Decide if name is allowed
    allowed, via, pulled_by = gate.decide(mac, qname)
    if not allowed:
        return None

    # Forward to upstream
    reply = forward(query, server)
    if reply is None:
        return servfail(query)

    # Parse reply and extract IPs (only for the asked name / its CNAME chain)
    ips, ttl = a_records(reply, qname)
    if not ips:
        return reply

    gate.record(mac, qname, ips, ttl, via, pulled_by)
    # Install (or refresh) every pair with its remaining lifetime BEFORE replying,
    # so the kid's first connection after the answer is already allowed.
    secs = gate.remaining(mac, ips)
    if secs:
        firewall_add(
            {(mac, ip): t for ip, t in secs.items()},
            {(ip, client_ip): t for ip, t in secs.items()},
        )

    return reply
