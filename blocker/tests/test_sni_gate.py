import socket
import ssl
import threading

import pytest
from blocker import portal, sni_gate
from blocker.firewall import render_ruleset


def _hello(name: str) -> bytes:
    ctx = ssl.create_default_context()
    out = ssl.MemoryBIO()
    obj = ctx.wrap_bio(ssl.MemoryBIO(), out, server_hostname=name)
    try:
        obj.do_handshake()
    except ssl.SSLWantReadError:
        pass
    return out.read()


def test_sni_of_reads_real_client_hello():
    assert sni_gate.sni_of(_hello("www.google.com")) == "www.google.com"
    assert sni_gate.sni_of(_hello("YouTube.com")) == "youtube.com"
    assert sni_gate.sni_of(b"GET / HTTP/1.1\r\n") is None
    assert sni_gate.sni_of(b"\x16\x03\x01") is None


def _run(name: str):
    dialed, got = [], []
    a, b = socket.socketpair()
    up_a, up_b = socket.socketpair()

    def connect(addr, timeout):
        dialed.append(addr)
        return up_a

    t = threading.Thread(
        target=sni_gate._serve, args=(b,), kwargs={"connect": connect}, daemon=True
    )
    t.start()
    hello = _hello(name)
    a.sendall(hello)
    if name in sni_gate.PASS_NAMES:
        got.append(up_b.recv(len(hello)))
    a.close()
    up_b.close()
    t.join(5)
    return dialed, got, hello


def test_gate_passes_allowlisted_name_by_name_and_replays_hello():
    dialed, got, hello = _run("www.google.com")
    assert dialed == [("www.google.com", 443)]
    assert got == [hello]


def test_gate_closes_other_names_without_dialing():
    dialed, got, _ = _run("youtube.com")
    assert dialed == [] and got == []


def test_dns_gives_blocked_devices_real_addresses(monkeypatch):
    from blocker.scapy_lite import DNS, DNSQR

    monkeypatch.setattr(portal, "real_ip", lambda n, **kw: {"www.google.com": "142.250.1.1"}.get(n))

    def ask(name):
        q = bytes(DNS(id=1, rd=1, qd=DNSQR(qname=name)))
        return DNS(portal.handle_query(q, ("10.0.0.5", 5353), "10.0.0.2")).an[0].rdata

    assert ask("www.google.com") == "142.250.1.1"
    assert ask("unresolvable.example") == "10.0.0.2"  # lookup failed: portal address


def test_ruleset_sends_blocked_https_through_gate_but_not_box_pages():
    r = render_ruleset({"192.168.1.50"}, set(), set(), ["192.168.0.0/16"], "", 80)
    lines = r.splitlines()
    gate = next(i for i, ln in enumerate(lines) if "redirect to :8443" in ln)
    assert "fib daddr type != local tcp dport 443" in lines[gate]
    assert any("@hw_out tcp dport 443 return" in ln for ln in lines[:gate])


def _hello12(name: str) -> bytes:
    ctx = ssl.create_default_context()
    ctx.maximum_version = ssl.TLSVersion.TLSv1_2
    out = ssl.MemoryBIO()
    try:
        ctx.wrap_bio(ssl.MemoryBIO(), out, server_hostname=name).do_handshake()
    except ssl.SSLWantReadError:
        pass
    return out.read()


def _rec(kind: int, n: int) -> bytes:
    """A TLS record of n payload bytes (n + 5 on the wire)."""
    return bytes([kind, 3, 3]) + n.to_bytes(2, "big") + b"r" * n


def _server_hello(tls13: bool) -> bytes:
    exts = b"\x00\x2b\x00\x02\x03\x04" if tls13 else b""
    body = b"\x03\x03" + b"R" * 32 + b"\x00" + b"\x13\x01" + b"\x00"
    body += len(exts).to_bytes(2, "big") + exts
    hs = b"\x02" + len(body).to_bytes(3, "big") + body
    return b"\x16\x03\x03" + len(hs).to_bytes(2, "big") + hs


def test_ticket_offer_needs_tls13_and_psk_dhe_ke_in_the_client_hello():
    assert sni_gate.offers_ticket(_hello("www.google.com"))
    assert not sni_gate.offers_ticket(_hello12("www.google.com"))
    psk_ke_only = _hello("www.google.com").replace(
        b"\x00\x2d\x00\x02\x01\x01", b"\x00\x2d\x00\x02\x01\x00"
    )
    assert not sni_gate.offers_ticket(psk_ke_only)


def test_server_hello_tls13_check():
    assert sni_gate.picked_tls13(_server_hello(True))
    assert not sni_gate.picked_tls13(_server_hello(False))
    assert not sni_gate.picked_tls13(_rec(0x17, 40))


def _session(hello: bytes, before: list[bytes], after: list[bytes]) -> bytes:
    """Client sends hello, gets `before`, sends its first app-data record, then upstream sends
    `after` and closes. Returns everything the client received after its app-data record."""
    a, b = socket.socketpair()
    up_a, up_b = socket.socketpair()
    t = threading.Thread(
        target=sni_gate._serve, args=(b,), kwargs={"connect": lambda *_, **__: up_a}, daemon=True
    )
    t.start()
    a.settimeout(5)
    up_b.settimeout(5)
    a.sendall(hello)
    assert up_b.recv(len(hello)) == hello
    pre = b"".join(before)
    up_b.sendall(pre)
    got = b""
    while len(got) < len(pre):
        got += a.recv(65536)
    req = _rec(0x14, 1) + _rec(0x17, 53) + _rec(0x17, 229)
    a.sendall(req)
    seen = b""
    while len(seen) < len(req):
        seen += up_b.recv(65536)
    for r in after:
        try:
            up_b.sendall(r)
        except OSError:
            break
    try:
        up_b.shutdown(socket.SHUT_WR)  # server done (Android's probe asks for Connection: close)
    except OSError:
        pass
    got = b""
    while chunk := a.recv(65536):
        got += chunk
    a.close()
    up_b.close()
    t.join(5)
    return got


# Measured on the beta box 2026-11-12: Android's probe gets a 559 B ticket then a 220 B
# "204 No Content"; the smallest readable www.google.com reply seen is ~790 B (Range on robots.txt).
HS13 = [_server_hello(True), _rec(0x14, 1), _rec(0x17, 2648)]
HS12 = [_server_hello(False), _rec(0x16, 3000)]
PROBE = [_rec(0x17, 559), _rec(0x17, 220)]


def test_gate_passes_androids_probe_profile():
    assert _session(_hello("www.google.com"), HS13, PROBE) == b"".join(PROBE)


def test_gate_cuts_a_reply_too_big_for_a_probe():
    after = [_rec(0x17, 559), _rec(0x17, 1395)]
    assert _session(_hello("www.google.com"), HS13, after) == after[0]


def test_gate_counts_reply_bytes_not_records():
    # h2 (ticket, SETTINGS, ack, headers) or tiny records (record_size_limit) share one byte budget
    tiny = [_rec(0x17, 30)] * 20
    got = _session(_hello("www.google.com"), HS13, [_rec(0x17, 559)] + tiny)
    assert len(got) == 564 + 35 * (sni_gate.REPLY_MAX // 35)


def test_no_ticket_room_unless_the_server_confirms_tls13():
    # client offered a TLS 1.3 ticket, but the server picked TLS 1.2: no ticket record will come
    assert _session(_hello("www.google.com"), HS12, PROBE) == b""
    assert _session(_hello("www.google.com"), HS12, [_rec(0x17, 220)]) == _rec(0x17, 220)


def test_no_ticket_room_unless_the_client_offers_one():
    assert _session(_hello12("www.google.com"), HS12, [_rec(0x17, 700)]) == b""
    after = [_rec(0x16, 200), _rec(0x17, 220)]  # TLS 1.2 handshake records are not app data
    assert _session(_hello12("www.google.com"), HS12, after) == b"".join(after)


def test_gate_caps_total_bytes_down():
    assert _session(_hello("www.google.com"), [_rec(0x16, 4000)], [_rec(0x16, 4500)]) == b""


@pytest.fixture(autouse=True)
def _fresh_budgets(monkeypatch):
    monkeypatch.setattr(sni_gate, "_use", {})


def test_module_docstring_describes_dns_behaviour():
    from blocker import sni_gate

    doc = sni_gate.__doc__
    assert "real addresses only for PASS_NAMES" not in doc
    assert "NODATA" in doc
