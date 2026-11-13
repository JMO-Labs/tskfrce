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


def test_pipe_cuts_a_passed_connection_after_the_cap():
    src_a, src_b = socket.socketpair()
    dst_a, dst_b = socket.socketpair()
    src_a.sendall(b"x" * 5000)
    src_a.close()
    sni_gate._pipe(src_b, dst_a, cap=1200)
    got = b""
    while chunk := dst_b.recv(65536):
        got += chunk
    assert got == b"x" * 1200


def test_budget_reserves_per_connection_and_resets_each_window(monkeypatch):
    monkeypatch.setattr(sni_gate, "_spent", {})
    shares = [sni_gate._allowance("10.0.0.9", 100.0) for _ in range(4)]
    assert shares == [8192, 8192, 8192, 0]  # 24 KB per window, reserved up front
    sni_gate._refund("10.0.0.9", 8192 - 4700)  # a probe-sized connection gives back the rest
    assert sni_gate._allowance("10.0.0.9", 101.0) == 8192 - 4700
    assert sni_gate._allowance("10.0.0.9", 100.0 + sni_gate.BUDGET_WINDOW) == 8192
    assert sni_gate._allowance("10.0.0.8", 101.0) == 8192  # per device


def test_module_docstring_describes_dns_behaviour():
    from blocker import sni_gate

    doc = sni_gate.__doc__
    assert "real addresses only for PASS_NAMES" not in doc
    assert "NODATA" in doc
