"""Upstream forwarding hardening: connected socket, txid/question checks, answer scoping."""

from __future__ import annotations

import socket
import threading

from blocker.upstream import a_records, forward
from scapy.layers.dns import DNS, DNSQR, DNSRR


def _query(name="khan.org.", qtype=1, txid=0x1234) -> bytes:
    return bytes(DNS(id=txid, qr=0, rd=1, qd=[DNSQR(qname=name, qtype=qtype)]))


def _reply(name="khan.org.", qtype=1, txid=0x1234, an=None) -> bytes:
    an = an if an is not None else [DNSRR(rrname=name, type="A", ttl=300, rdata="1.2.3.4")]
    return bytes(DNS(id=txid, qr=1, ra=1, qd=[DNSQR(qname=name, qtype=qtype)], an=an))


def _upstream(*answers, spoof_first: bytes | None = None):
    """Fake resolver on 127.0.0.1: replies with `answers` in order (optionally a spoof first)."""
    srv = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    srv.bind(("127.0.0.1", 0))
    srv.settimeout(3)

    def run():
        try:
            _, client = srv.recvfrom(4096)
        except OSError:
            return
        if spoof_first is not None:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as other:
                other.sendto(spoof_first, client)  # same host, wrong source port
        for a in answers:
            srv.sendto(a, client)
        srv.close()

    threading.Thread(target=run, daemon=True).start()
    return srv.getsockname()[1]


def test_forward_accepts_matching_reply():
    port = _upstream(_reply())
    assert forward(_query(), "127.0.0.1", timeout=2, port=port) == _reply()


def test_forward_discards_wrong_txid_then_accepts_right_one():
    good = _reply()
    port = _upstream(_reply(txid=0x9999), good)
    assert forward(_query(), "127.0.0.1", timeout=2, port=port) == good


def test_forward_discards_wrong_question():
    good = _reply()
    port = _upstream(_reply(name="evil.com."), _reply(qtype=28), good)
    assert forward(_query(), "127.0.0.1", timeout=2, port=port) == good


def test_forward_rejects_echoed_query_and_times_out():
    port = _upstream(_query())  # qr=0: not a reply
    assert forward(_query(), "127.0.0.1", timeout=0.3, port=port) is None


def test_forward_ignores_datagram_from_other_source():
    """Connected socket: a perfect-looking reply from another port never reaches us."""
    spoof = _reply(an=[DNSRR(rrname="khan.org.", type="A", ttl=300, rdata="6.6.6.6")])
    good = _reply()
    port = _upstream(good, spoof_first=spoof)
    assert forward(_query(), "127.0.0.1", timeout=2, port=port) == good


def test_forward_unparsable_query_returns_none():
    assert forward(b"garbage", "127.0.0.1", timeout=0.1) is None


def test_a_records_only_qname_and_cname_chain():
    an = [
        DNSRR(rrname="www.khan.org.", type="CNAME", ttl=600, rdata="cdn.example.net."),
        DNSRR(rrname="cdn.example.net.", type="A", ttl=120, rdata="1.2.3.4"),
        DNSRR(rrname="unrelated.com.", type="A", ttl=60, rdata="6.6.6.6"),
    ]
    reply = _reply(name="www.khan.org.", an=an)
    assert a_records(reply, "www.khan.org") == (["1.2.3.4"], 120)


def test_a_records_rejects_reply_for_other_question():
    assert a_records(_reply(name="evil.com."), "khan.org") == ([], 0)
