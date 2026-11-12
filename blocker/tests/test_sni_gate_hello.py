"""Strict ClientHello parsing: the gate must read the hello the way a TLS server does."""

import socket
import threading
import time

import pytest

from blocker import sni_gate
from blocker.tests.test_sni_gate import _hello


def _ext(kind: int, data: bytes) -> bytes:
    return kind.to_bytes(2, "big") + len(data).to_bytes(2, "big") + data


def _sni(*names: bytes) -> bytes:
    lst = b"".join(b"\x00" + len(n).to_bytes(2, "big") + n for n in names)
    return _ext(0, len(lst).to_bytes(2, "big") + lst)


TLS13 = _ext(43, b"\x02\x03\x04")
PSK = _ext(45, b"\x01\x01")


def _msg(exts: bytes, trailer: bytes = b"", ext_len: int | None = None) -> bytes:
    """ClientHello handshake message (4-byte header included)."""
    n = len(exts) if ext_len is None else ext_len
    body = b"\x03\x03" + b"R" * 32 + b"\x00" + b"\x00\x02\x13\x01" + b"\x01\x00"
    body += n.to_bytes(2, "big") + exts + trailer
    return b"\x01" + len(body).to_bytes(3, "big") + body


def _records(msg: bytes, *cuts: int, kind: int = 0x16) -> bytes:
    """msg as TLS records, split at the given offsets."""
    out, edges = b"", [0, *cuts, len(msg)]
    for a, b in zip(edges, edges[1:]):
        out += bytes([kind, 3, 1]) + (b - a).to_bytes(2, "big") + msg[a:b]
    return out


GOOD = _records(_msg(_sni(b"www.google.com") + TLS13 + PSK))


def test_builder_hello_is_accepted():
    assert sni_gate.sni_of(GOOD) == "www.google.com"
    assert sni_gate.offers_ticket(GOOD)


def test_hello_split_across_two_tls_records_is_reassembled_like_a_server_does():
    msg = _msg(_sni(b"www.google.com") + TLS13 + PSK)
    split = _records(msg, 2)  # even the 4-byte handshake header is split
    assert sni_gate.sni_of(split) == "www.google.com"
    assert sni_gate.offers_ticket(split)


@pytest.mark.parametrize(
    "raw",
    [
        _records(_msg(_sni(b"www.google.com") + _sni(b"www.google.com"))),  # duplicate extension
        _records(_msg(_sni(b"www.google.com", b"youtube.com"))),  # two host names
        _records(_msg(_sni(b"www.google.com"), trailer=b"\x00")),  # bytes after extensions
        _records(_msg(_sni(b"www.google.com"), ext_len=3)),  # extensions length lies
        _records(_msg(_sni(b"www.google.com")) + b"\x00"),  # bytes after the message
        _records(_msg(_sni(b"www.google.com")), kind=0x17),  # not a handshake record
        b"\x17\x03\x03\x00\x01x" + GOOD,  # something before the hello
        _records(b"\x02" + _msg(_sni(b"www.google.com"))[1:]),  # not a ClientHello
        _records(_msg(_ext(0, b"\x00\x06\x00\x00\x02ab"))),  # SNI list length lies
        GOOD[:-3],  # truncated
    ],
)
def test_malformed_hellos_neither_pass_nor_get_allowances(raw):
    assert sni_gate.sni_of(raw) is None
    assert not sni_gate.offers_ticket(raw)


def _serve_with(chunks: list[bytes], pause: float = 0.05):
    dialed, got = [], b""
    a, b = socket.socketpair()
    up_a, up_b = socket.socketpair()
    up_b.settimeout(3)

    def connect(addr, timeout):
        dialed.append(addr)
        return up_a

    t = threading.Thread(
        target=sni_gate._serve, args=(b,), kwargs={"connect": connect}, daemon=True
    )
    t.start()
    for c in chunks:
        a.sendall(c)
        time.sleep(pause)
    want = sum(map(len, chunks))
    try:
        while len(got) < want and (chunk := up_b.recv(65536)):
            got += chunk
    except OSError:
        pass
    a.close()
    up_b.close()
    t.join(5)
    return dialed, got


def test_hello_in_several_tcp_chunks_still_passes():
    hello = _hello("www.google.com")
    chunks = [hello[:3], hello[3:200], hello[200:]]
    dialed, got = _serve_with(chunks)
    assert dialed == [("www.google.com", 443)] and got == hello


def test_hello_in_two_tls_records_passes_and_is_forwarded_as_sent():
    raw = _records(_msg(_sni(b"www.google.com") + TLS13 + PSK), 40)
    dialed, got = _serve_with([raw])
    assert dialed == [("www.google.com", 443)] and got == raw


def test_malformed_hello_is_closed_without_dialing():
    dialed, got = _serve_with([_records(_msg(_sni(b"www.google.com") * 2))])
    assert dialed == [] and got == b""
