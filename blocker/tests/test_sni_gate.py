import socket
import ssl
import threading

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

    monkeypatch.setattr(portal, "real_ip", lambda n: {"www.google.com": "142.250.1.1"}.get(n))

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
    return bytes([kind, 3, 3]) + n.to_bytes(2, "big") + b"r" * n


def test_reply_limits_allow_a_ticket_only_when_the_client_offers_tls13_resumption():
    assert sni_gate.reply_limits(_hello("www.google.com")) == [
        sni_gate.TICKET_MAX,
        sni_gate.REPLY_MAX,
    ]
    assert sni_gate.reply_limits(_hello12("www.google.com")) == [sni_gate.REPLY_MAX]
    psk_ke_only = _hello("www.google.com").replace(
        b"\x00\x2d\x00\x02\x01\x01", b"\x00\x2d\x00\x02\x01\x00"
    )
    assert sni_gate.reply_limits(psk_ke_only) == [sni_gate.REPLY_MAX]


def _session(hello: bytes, before: list[bytes], after: list[bytes]) -> bytes:
    """Client sends hello, gets `before`, sends its first app-data record, then upstream sends
    `after`. Returns everything the client received after its app-data record."""
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
    up_b.shutdown(socket.SHUT_WR)  # server done (Android's probe asks for Connection: close)
    got = b""
    while chunk := a.recv(65536):
        got += chunk
    a.close()
    up_b.close()
    t.join(5)
    return got


# Measured on the beta box 2026-11-12: Android's probe gets a 559 B ticket then a 220 B
# "204 No Content"; the smallest readable www.google.com reply seen is ~790 B (Range on robots.txt).
HANDSHAKE = [_rec(0x16, 128), _rec(0x14, 1), _rec(0x17, 2648)]


def test_gate_passes_androids_probe_profile():
    after = [_rec(0x17, 559), _rec(0x17, 220)]
    assert _session(_hello("www.google.com"), HANDSHAKE, after) == b"".join(after)


def test_gate_cuts_a_reply_too_big_for_a_probe():
    after = [_rec(0x17, 559), _rec(0x17, 1395)]
    assert _session(_hello("www.google.com"), HANDSHAKE, after) == after[0]


def test_gate_cuts_extra_records_after_the_probe_reply():
    after = [_rec(0x17, 583), _rec(0x17, 57), _rec(0x17, 26)]  # h2: ticket, SETTINGS, ack
    assert _session(_hello("www.google.com"), HANDSHAKE, after) == b"".join(after[:2])


def test_gate_without_tickets_gives_no_room_for_a_ticket_sized_reply():
    after = [_rec(0x17, 700)]
    assert _session(_hello12("www.google.com"), [_rec(0x16, 3000)], after) == b""
    after = [_rec(0x16, 200), _rec(0x17, 220)]  # TLS 1.2 handshake records are not counted
    assert _session(_hello12("www.google.com"), [_rec(0x16, 3000)], after) == b"".join(after)


def test_gate_caps_total_bytes_down():
    assert _session(_hello("www.google.com"), [_rec(0x16, 4000)], [_rec(0x16, 4500)]) == b""
