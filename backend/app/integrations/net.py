"""SSRF-safe outbound HTTP for calls a box makes to integration servers.

Resolve the host once, refuse if any answer is non-public, then connect to that checked IP
(sending the real name as Host and TLS SNI), so DNS rebinding cannot redirect the call.
"""

import ipaddress
import socket
import time
from dataclasses import dataclass

import httpx

CGNAT = ipaddress.ip_network("100.64.0.0/10")
USER_AGENT = "t@sk4ce-box/1"


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


def is_public(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    # is_global lets multicast through, so refuse it explicitly.
    return ip.is_global and not ip.is_multicast and ip not in CGNAT


def resolve_pinned(host: str, port: int, policy: OutboundPolicy) -> str:
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except (OSError, UnicodeError) as e:
        raise FetchError(f"dns: {e}") from e
    ips = [ipaddress.ip_address(str(info[4][0]).split("%")[0]) for info in infos]
    if not ips:
        raise FetchError("dns: no addresses")
    if not policy.allow_private and not all(is_public(ip) for ip in ips):
        raise BlockedError(f"{host} resolves to a non-public address")
    return str(ips[0])


def _target(url: httpx.URL, policy: OutboundPolicy) -> int:
    """Check scheme, host and port against the policy; return the effective port."""
    if url.scheme not in ("https", "http") or (policy.https_only and url.scheme != "https"):
        raise BlockedError(f"scheme not allowed: {url.scheme}")
    if not url.host:
        raise BlockedError("missing host")
    port = url.port or (443 if url.scheme == "https" else 80)
    if policy.port_443_only and port != 443:
        raise BlockedError(f"port not allowed: {port}")
    return port


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
    u = httpx.URL(url)
    port = _target(u, policy)
    host = u.raw_host.decode("ascii")
    ip = resolve_pinned(host, port, policy)
    hdrs = {k: v for k, v in (headers or {}).items() if k.lower() not in ("cookie", "host")}
    hdrs["Host"] = u.netloc.decode("ascii").rpartition("@")[2]
    hdrs["User-Agent"] = USER_AGENT
    hdrs["Accept-Encoding"] = "identity"  # so max_bytes bounds the real body size
    try:
        with httpx.Client(
            transport=transport,
            follow_redirects=False,
            timeout=httpx.Timeout(timeout),
            trust_env=False,
        ) as client:
            req = client.build_request(
                method,
                u.copy_with(host=ip),
                content=body,
                headers=hdrs,
                extensions={"sni_hostname": host},
            )
            resp = client.send(req, stream=True)
            try:
                if 300 <= resp.status_code < 400:
                    raise FetchError("redirect")
                if resp.status_code >= 400:
                    raise FetchError(f"status {resp.status_code}")
                data = bytearray()
                for chunk in resp.iter_bytes():
                    data += chunk
                    if len(data) > max_bytes:
                        raise FetchError("too large")
                    if time.monotonic() > deadline:
                        raise FetchError("timeout")
                ctype = resp.headers.get("content-type", "")
                return GuardedResponse(resp.status_code, ctype, bytes(data))
            finally:
                resp.close()
    except httpx.TimeoutException as e:
        raise FetchError("timeout") from e
    except httpx.HTTPError as e:
        raise FetchError(f"transport: {e}") from e
