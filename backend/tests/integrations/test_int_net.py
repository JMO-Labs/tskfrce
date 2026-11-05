import ipaddress

import httpx
import pytest
from app.integrations.net import (
    DEV,
    STRICT,
    BlockedError,
    FetchError,
    fetch,
    is_public,
    resolve_pinned,
)
from tests.integrations.int_helpers import reply


@pytest.mark.parametrize(
    "ip",
    ["127.0.0.1", "10.1.2.3", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1",
     "fe80::1", "::ffff:192.168.1.1", "0.0.0.0"],
)  # fmt: skip
def test_private_targets_blocked(resolve_to, ip):
    resolve_to(ip)
    with pytest.raises(BlockedError):
        fetch("GET", "https://svc.example/v1/poll")


@pytest.mark.parametrize(
    "ip",
    [
        "172.16.0.1",  # private
        "127.8.8.8",  # loopback
        "169.254.1.1",  # link-local
        "100.127.255.254",  # CGNAT upper edge
        "192.168.1.50",  # the box's own LAN
        "fd12:3456::1",  # IPv6 ULA
        "fe80::abcd",  # IPv6 link-local
        "::ffff:127.0.0.1",  # IPv4-mapped loopback
        "::ffff:10.0.0.1",  # IPv4-mapped private
        "::ffff:100.64.0.1",  # IPv4-mapped CGNAT
        "224.0.1.1",  # multicast (is_global is True for it)
        "ff0e::1",  # IPv6 global-scope multicast
        "240.0.0.1",  # reserved
        "::",  # unspecified
    ],
)
def test_hostname_resolving_to_blocked_range(resolve_to, ip):
    resolve_to(ip)
    with pytest.raises(BlockedError):
        resolve_pinned("svc.example", 443, STRICT)


@pytest.mark.parametrize(
    ("host", "ip"), [("localhost", "127.0.0.1"), ("127.0.0.1.", "127.0.0.1"), ("localhost", "::1")]
)
def test_loopback_hosts_manifest_accepts_are_refused(resolve_to, host, ip):
    resolve_to(ip)
    with pytest.raises(BlockedError):
        fetch("GET", f"https://{host}/")


def test_cgnat_check_independent_of_is_global():
    assert not is_public(ipaddress.ip_address("100.64.0.1"))
    assert is_public(ipaddress.ip_address("93.184.216.34"))


def test_any_private_answer_blocks(resolve_to):
    resolve_to("93.184.216.34", "10.0.0.1")
    with pytest.raises(BlockedError):
        fetch("GET", "https://svc.example/")


def test_no_answers_is_fetch_error(resolve_to):
    resolve_to()
    with pytest.raises(FetchError):
        fetch("GET", "https://svc.example/")


def test_connects_to_pinned_ip(resolve_to, seen):
    resolve_to("93.184.216.34")
    fetch("GET", "https://svc.example/x", transport=seen.transport)
    assert seen.url.host == "93.184.216.34" and seen.headers["host"] == "svc.example"
    assert seen.extensions["sni_hostname"] == "svc.example"


def test_pins_ipv6_with_brackets(resolve_to, seen):
    resolve_to("2606:2800:220:1:248:1893:25c8:1946")
    fetch("GET", "https://svc.example/x?a=1", transport=seen.transport)
    assert str(seen.url) == "https://[2606:2800:220:1:248:1893:25c8:1946]/x?a=1"
    assert seen.headers["host"] == "svc.example"


def test_headers_body_and_no_cookies(resolve_to, seen):
    r = fetch(
        "POST",
        "https://svc.example/x",
        body=b'{"a":1}',
        headers={"content-type": "application/json", "cookie": "a=b"},
        transport=seen.transport,
    )
    assert seen.headers["user-agent"] == "t@sk4ce-box/1"
    assert "cookie" not in seen.headers
    assert (r.status, r.content_type, r.body) == (200, "application/json", b"{}")


def test_redirect_is_failure(resolve_to):
    resolve_to("93.184.216.34")
    with pytest.raises(FetchError, match="redirect"):
        fetch(
            "GET",
            "https://svc.example/",
            transport=reply(302, headers={"location": "http://192.168.1.1"}),
        )


def test_error_status_is_failure():
    with pytest.raises(FetchError, match="status 500"):
        fetch("GET", "https://svc.example/", transport=reply(500))


@pytest.mark.parametrize(
    "url", ["http://svc.example/", "https://svc.example:8443/", "ftp://svc.example/", "https:///"]
)
def test_scheme_and_port(url):
    with pytest.raises(BlockedError):
        fetch("GET", url)


def test_explicit_443_allowed(seen):
    assert fetch("GET", "https://svc.example:443/", transport=seen.transport).status == 200


def test_size_cap(resolve_to):
    resolve_to("93.184.216.34")
    with pytest.raises(FetchError, match="too large"):
        fetch("GET", "https://svc.example/", transport=reply(200, content=b"x" * 262_145))


def test_size_at_cap_ok():
    r = fetch("GET", "https://svc.example/", transport=reply(200, content=b"x" * 262_144))
    assert len(r.body) == 262_144


def test_timeout_is_fetch_error():
    def boom(req):
        raise httpx.ReadTimeout("slow", request=req)

    with pytest.raises(FetchError, match="timeout"):
        fetch("GET", "https://svc.example/", transport=httpx.MockTransport(boom))


def test_transport_error_is_fetch_error():
    def boom(req):
        raise httpx.ConnectError("refused", request=req)

    with pytest.raises(FetchError, match="transport"):
        fetch("GET", "https://svc.example/", transport=httpx.MockTransport(boom))


def test_wall_clock_deadline(monkeypatch):
    """A server trickling bytes past the total budget is cut off mid-stream."""
    from app.integrations import net

    ticks = iter([0.0])  # first call sets the deadline; every later call is past it
    monkeypatch.setattr(net.time, "monotonic", lambda: next(ticks, 10.0))
    stream = _Chunks([b"a", b"b", b"c"])
    with pytest.raises(FetchError, match="timeout"):
        fetch(
            "GET",
            "https://svc.example/",
            transport=httpx.MockTransport(lambda req: httpx.Response(200, stream=stream)),
        )


class _Chunks(httpx.SyncByteStream):
    def __init__(self, parts):
        self.parts = parts

    def __iter__(self):
        yield from self.parts


def test_dev_policy_allows_loopback_http(resolve_to):
    resolve_to("127.0.0.1")
    assert fetch("GET", "http://localhost:8080/", policy=DEV, transport=reply(200)).status == 200
