"""End-to-end handle_homework: real scapy packets, real gate; only the socket is stubbed."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from unittest.mock import patch

from blocker.homework import HomeworkGate
from blocker.upstream import handle_homework
from scapy.layers.dns import DNS, DNSQR, DNSRR

MAC = "aa:bb:cc:dd:ee:ff"
KID = "192.168.1.50"


def _query(name: str) -> bytes:
    return bytes(DNS(id=0x4242, qr=0, rd=1, qd=[DNSQR(qname=name, qtype=1)]))


def _reply(name: str, ip: str) -> bytes:
    an = [DNSRR(rrname=name, type="A", ttl=600, rdata=ip)]
    return bytes(DNS(id=0x4242, qr=1, ra=1, qd=[DNSQR(qname=name, qtype=1)], an=an))


class _FakeSock:
    """Stands in for the upstream UDP socket: answers the first send with `reply`."""

    def __init__(self, reply: bytes):
        self.reply = reply

    def __call__(self, *_a):
        return self

    def __enter__(self):
        return self

    def __exit__(self, *_a):
        return False

    def connect(self, _addr):
        pass

    def send(self, _data):
        pass

    def settimeout(self, _t):
        pass

    def recv(self, _n):
        return self.reply


def _gate() -> HomeworkGate:
    gate = HomeworkGate()
    until = (datetime.now(UTC) + timedelta(hours=1)).isoformat()
    gate.update({MAC: {"allow": ["classroom.google.com"], "block": [], "until": until}})
    return gate


def _run(gate, name: str, ip: str):
    installed = []
    with patch("blocker.upstream.socket.socket", _FakeSock(_reply(name, ip))):
        out = handle_homework(
            gate,
            lambda o, b: installed.append((o, b)),
            lambda _ip: MAC,
            "9.9.9.9",
            KID,
            _query(name),
        )
    return out, installed


def test_allowed_name_gets_real_answer_and_pairs():
    gate = _gate()
    out, installed = _run(gate, "classroom.google.com.", "142.250.1.1")
    assert out is not None
    assert str(DNS(out).an[0].rdata) == "142.250.1.1"
    assert len(installed) == 1
    hw_out, hw_back = installed[0]
    assert (MAC, "142.250.1.1") in hw_out
    assert ("142.250.1.1", KID) in hw_back
    assert (MAC, "142.250.1.1") in gate.pairs()


def test_unlisted_name_falls_back_to_portal():
    out, installed = _run(_gate(), "games.example.", "6.6.6.6")
    assert out is None
    assert installed == []
