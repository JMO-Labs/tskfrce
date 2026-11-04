"""Upstream DNS forwarding for homework mode."""

from __future__ import annotations

import logging
import socket

log = logging.getLogger(__name__)


def forward(query: bytes, server: str, timeout: float = 2.0) -> bytes | None:
    """Send a DNS query to upstream server via UDP; return reply or None on timeout/error."""
    if not server:
        return None
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.settimeout(timeout)
        try:
            sock.sendto(query, (server, 53))
            reply, _ = sock.recvfrom(512)
            return reply
        finally:
            sock.close()
    except (socket.timeout, OSError):
        return None


def a_records(reply: bytes) -> tuple[list[str], int]:
    """Extract IPv4 addresses and minimum TTL from a DNS reply using scapy."""
    from scapy.layers.dns import DNS

    try:
        resp = DNS(reply)
        if resp.qr != 1 or resp.qdcount == 0:
            return [], 0
        ips = []
        ttl = 3600  # Default if no answers
        if resp.an:
            for rr in resp.an:
                if hasattr(rr, "type") and rr.type == 1:  # A record
                    if hasattr(rr, "rdata") and hasattr(rr, "ttl"):
                        ips.append(str(rr.rdata))
                        ttl = min(ttl, rr.ttl)
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


def handle_homework(gate, firewall_add, mac_for_ip, server: str, client_ip: str, query: bytes) -> bytes | None:
    """DNS handle for homework mode: forward allowed queries, record pairs, pre-install in firewall.

    Returns the reply bytes if allowed and forwarded, None to fall back to portal.
    """
    from scapy.layers.dns import DNS

    try:
        # Parse the query
        q = DNS(query)
        if q.qr != 0 or q.opcode != 0 or q.qdcount != 1:
            return None
        qname = str(q.qd[0].qname).lower().rstrip(".")
        qtype = q.qd[0].qtype
    except Exception:
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

    # Parse reply and extract IPs
    ips, ttl = a_records(reply)
    if not ips:
        return reply

    # Record the lookup and get newly added IPs
    new_ips = gate.record(mac, qname, ips, ttl, via, pulled_by)

    # Pre-install pairs in firewall BEFORE returning reply
    if new_ips:
        firewall_add(
            {(mac, ip) for ip in new_ips},
            {(ip, client_ip) for ip in new_ips},
        )

    return reply
