"""SSRF-safe outbound HTTP for calls a box makes to integration servers.

Resolve the host once, refuse if any answer is non-public, then connect to that checked IP
(sending the real name as Host and TLS SNI), so DNS rebinding cannot redirect the call.

The timeout is a total budget: DNS, connect, send and every body read get only what is left of
it. The deadline is checked between phases and after each chunk, so the worst overshoot is one
read, which is itself bounded by the budget left when the request was sent.
"""

import ipaddress
import socket
import threading
import time
from dataclasses import dataclass

import httpx

USER_AGENT = "t@sk4ce-box/1"
_net = ipaddress.ip_network
# Explicit lists, not is_global/is_private, whose meaning shifts between Python versions.
V4_BLOCKED = [
    _net(n)
    for n in (
        "0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16",
        "172.16.0.0/12", "192.0.0.0/24", "192.0.2.0/24", "192.88.99.0/24", "192.168.0.0/16",
        "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "224.0.0.0/4", "240.0.0.0/4",
    )
]  # fmt: skip
V6_GLOBAL_UNICAST = _net("2000::/3")  # excludes ::/8, fc00::/7, fe80::/10, fec0::/10, ff00::/8
V6_BLOCKED = [_net(n) for n in ("2001:db8::/32", "3fff::/20", "2001:2::/48", "2001:10::/28")]
V4_COMPAT = _net("::/96")
# Only the well-known /96 is unwrapped. Local-use 64:ff9b:1::/48 (RFC 8215) may use a /48-/64
# translator prefix that puts the IPv4 elsewhere (RFC 6052), so it is refused by the 2000::/3 rule.
NAT64 = _net("64:ff9b::/96")


@dataclass(frozen=True)
class OutboundPolicy:
    https_only: bool = True
    port_443_only: bool = True
    allow_private: bool = False


STRICT = OutboundPolicy()
DEV = OutboundPolicy(False, False, True)  # simulator --dev only


class BlockedError(Exception):
    """Refused before connecting."""


class FetchError(Exception):
    """Timeout, size, status, redirect or transport failure."""


@dataclass
class GuardedResponse:
    status: int
    content_type: str
    body: bytes
    headers: dict | None = None


def _embedded_v4(ip: ipaddress.IPv6Address) -> ipaddress.IPv4Address | None:
    """The IPv4 address a v6 address carries (mapped, compat, NAT64, 6to4, Teredo client)."""
    if ip.ipv4_mapped:
        return ip.ipv4_mapped
    if ip in V4_COMPAT or ip in NAT64:
        return ipaddress.IPv4Address(int(ip) & 0xFFFFFFFF)
    if ip.sixtofour:
        return ip.sixtofour
    if ip.teredo:
        return ip.teredo[1]
    return None


def is_public(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    if isinstance(ip, ipaddress.IPv6Address):
        v4 = _embedded_v4(ip)
        if v4 is None:
            return ip in V6_GLOBAL_UNICAST and not any(ip in n for n in V6_BLOCKED)
        ip = v4
    return ip != ipaddress.IPv4Address("255.255.255.255") and not any(ip in n for n in V4_BLOCKED)


def _getaddrinfo(host: str, port: int) -> list:
    """Resolver seam (tests patch this, not the global socket module)."""
    return socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)


def _lookup(host: str, port: int, timeout: float | None) -> list:
    """_getaddrinfo bounded by timeout: run it in a daemon thread and stop waiting at the end."""
    out: dict = {}

    def run():
        try:
            out["infos"] = _getaddrinfo(host, port)
        except (OSError, UnicodeError) as e:
            out["err"] = e

    t = threading.Thread(target=run, daemon=True)
    t.start()
    t.join(timeout)
    if t.is_alive():
        raise FetchError("timeout: dns")
    if "err" in out:
        raise FetchError(f"dns: {out['err']}") from out["err"]
    return out["infos"]


def resolve_pinned(
    host: str, port: int, policy: OutboundPolicy, timeout: float | None = None
) -> str:
    infos = _lookup(host, port, timeout)
    ips = [ipaddress.ip_address(str(info[4][0]).split("%")[0]) for info in infos]
    if not ips:
        raise FetchError("dns: no addresses")
    if not policy.allow_private and not all(is_public(ip) for ip in ips):
        raise BlockedError(f"{host} resolves to a non-public address")
    return str(ips[0])


def _target(url: str, policy: OutboundPolicy) -> tuple[httpx.URL, int]:
    """Parse and check scheme, userinfo, host and port; return the URL and effective port."""
    try:
        u = httpx.URL(url)
    except (httpx.InvalidURL, TypeError, ValueError) as e:
        raise FetchError(f"bad url: {e}") from e
    if u.scheme not in ("https", "http") or (policy.https_only and u.scheme != "https"):
        raise BlockedError(f"scheme not allowed: {u.scheme}")
    if u.userinfo:
        raise BlockedError("credentials in url")
    if not u.raw_host:
        raise BlockedError("missing host")
    port = u.port or (443 if u.scheme == "https" else 80)
    if policy.port_443_only and port != 443:
        raise BlockedError(f"port not allowed: {port}")
    return u, port


def _left(deadline: float) -> float:
    """Seconds left before deadline; FetchError once it has passed."""
    left = deadline - time.monotonic()
    if left <= 0:
        raise FetchError("timeout")
    return left


def fetch(
    method: str,
    url: str,
    *,
    body: bytes | None = None,
    headers: dict | None = None,
    policy: OutboundPolicy = STRICT,
    max_bytes: int = 262_144,
    timeout: float = 5.0,
    transport: httpx.BaseTransport | None = None,
) -> GuardedResponse:
    deadline = time.monotonic() + timeout
    u, port = _target(url, policy)
    host = u.raw_host.decode("ascii")
    ip = resolve_pinned(host, port, policy, timeout=_left(deadline))
    hdrs = {k: v for k, v in (headers or {}).items() if k.lower() not in ("cookie", "host")}
    hdrs["Host"] = u.netloc.decode("ascii")
    hdrs["User-Agent"] = USER_AGENT
    hdrs["Accept-Encoding"] = "identity"
    try:
        with httpx.Client(transport=transport, follow_redirects=False, trust_env=False) as client:
            req = client.build_request(
                method,
                u.copy_with(host=ip),
                content=body,
                headers=hdrs,
                timeout=httpx.Timeout(_left(deadline)),
                extensions={"sni_hostname": host},
            )
            resp = client.send(req, stream=True)
            try:
                _left(deadline)
                if 300 <= resp.status_code < 400:
                    raise FetchError("redirect")
                if resp.status_code >= 400:
                    raise FetchError(f"status {resp.status_code}")
                encoding = resp.headers.get("content-encoding", "identity").strip().lower()
                if encoding != "identity":  # we asked for identity; never decompress
                    raise FetchError(f"content-encoding not allowed: {encoding}")
                data = bytearray()
                for chunk in resp.iter_raw():
                    data += chunk
                    if len(data) > max_bytes:
                        raise FetchError("too large")
                    _left(deadline)
                ctype = resp.headers.get("content-type", "")
                return GuardedResponse(resp.status_code, ctype, bytes(data), dict(resp.headers))
            finally:
                resp.close()
    except httpx.TimeoutException as e:
        raise FetchError("timeout") from e
    except httpx.HTTPError as e:
        raise FetchError(f"transport: {e}") from e
