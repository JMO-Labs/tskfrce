"""HTTPS gate for blocked devices: pass only allowlisted hosts (by TLS SNI), close the rest.

Android only treats Wi-Fi as online when https://www.google.com/generate_204 succeeds; without
it a blocked phone silently moves to mobile data. The firewall redirects a blocked device's
non-local :443 traffic here; DNS hands it real addresses only for PASS_NAMES.
Passed connections are cut after DOWN_CAP bytes: enough for the probe, not for search pages.
"""

from __future__ import annotations

import logging
import socket
import threading
import time
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FuturesTimeout

log = logging.getLogger(__name__)

PASS_NAMES = frozenset({"www.google.com"})
# Android's probe (TLS 1.3 handshake + "204 No Content") is ~4.7 KB down; a search page or an AMP
# article via www.google.com is far more. Per connection: DOWN_CAP. Per device: BUDGET bytes per
# BUDGET_WINDOW seconds across all its connections, so refreshing can't add pages up piece by piece.
DOWN_CAP = 8 * 1024
BUDGET = 24 * 1024
BUDGET_WINDOW = 60.0
_spent: dict[str, tuple[float, int]] = {}  # client ip -> (window start, bytes passed)
_spent_lock = threading.Lock()


def _allowance(client: str, now: float) -> int:
    """Reserve this connection's share of the client's window budget (0 = refuse). Reserving up
    front stops parallel connections from each taking a full share."""
    with _spent_lock:
        start, used = _spent.get(client, (now, 0))
        if now - start >= BUDGET_WINDOW:
            start, used = now, 0
        share = max(0, min(DOWN_CAP, BUDGET - used))
        _spent[client] = (start, used + share)
        return share


def _refund(client: str, n: int) -> None:
    """Give back the unused part of a reservation."""
    with _spent_lock:
        if client in _spent and n > 0:
            start, used = _spent[client]
            _spent[client] = (start, max(0, used - n))


GATE_PORT = 8443
_HELLO_MAX = 16384


def sni_of(hello: bytes) -> str | None:
    """Server name from a TLS ClientHello record, or None if absent/unparsable."""
    try:
        if hello[0] != 0x16 or hello[5] != 0x01:  # handshake record, ClientHello
            return None
        p = 9 + 2 + 32  # record(5) + handshake hdr(4), version, random
        p += 1 + hello[p]  # session id
        p += 2 + int.from_bytes(hello[p : p + 2], "big")  # cipher suites
        p += 1 + hello[p]  # compression methods
        end = p + 2 + int.from_bytes(hello[p : p + 2], "big")
        p += 2
        while p + 4 <= end:
            kind, size = (
                int.from_bytes(hello[p : p + 2], "big"),
                int.from_bytes(hello[p + 2 : p + 4], "big"),
            )
            p += 4
            if kind == 0:  # server_name: list len(2), type(1), name len(2), name
                n = int.from_bytes(hello[p + 3 : p + 5], "big")
                return hello[p + 5 : p + 5 + n].decode("ascii").lower().rstrip(".")
            p += size
    except (IndexError, UnicodeDecodeError):
        pass
    return None


CACHE_MAX = 512
NAMES_PER_MIN = 60  # unique upstream names per client per minute
LOOKUP_TIMEOUT = 2.0
_CACHE: OrderedDict[str, tuple[float, str]] = OrderedDict()  # name -> (stored at, ip), LRU order
_names: dict[str, tuple[float, set[str]]] = {}  # client -> (window start, names looked up)
_cache_lock = threading.Lock()
_pool = ThreadPoolExecutor(max_workers=8, thread_name_prefix="dns-up")


def _over_cap(client: str, name: str, now: float) -> bool:
    """True if client has used up its unique-name budget for this window (records name if not)."""
    with _cache_lock:
        start, seen = _names.get(client, (now, set()))
        if now - start >= 60:
            start, seen = now, set()
            for c in [c for c, (t, _) in _names.items() if now - t >= 60]:
                del _names[c]
        if name not in seen and len(seen) >= NAMES_PER_MIN:
            _names[client] = (start, seen)
            return True
        seen.add(name)
        _names[client] = (start, seen)
        return False


def _resolve(name: str) -> str:
    return str(socket.getaddrinfo(name, 443, socket.AF_INET, socket.SOCK_STREAM)[0][4][0])


def real_ip(name: str, ttl: float = 60, client: str = "") -> str | None:
    """Upstream IPv4 for name via the box's own resolver (cached ttl seconds, LRU-bounded).

    None on failure, timeout (LOOKUP_TIMEOUT) or when client is over its unique-name cap.
    """
    now = time.monotonic()
    with _cache_lock:
        hit = _CACHE.get(name)
        if hit and now - hit[0] < ttl:
            _CACHE.move_to_end(name)
            return hit[1]
    if _over_cap(client, name, now):
        return None
    try:
        ip = _pool.submit(_resolve, name).result(timeout=LOOKUP_TIMEOUT)
    except (OSError, FuturesTimeout):
        log.warning("resolving %s failed", name)
        return None
    with _cache_lock:
        _CACHE[name] = (time.monotonic(), ip)
        _CACHE.move_to_end(name)
        if len(_CACHE) > CACHE_MAX:
            now = time.monotonic()
            for k in [k for k, (t, _) in _CACHE.items() if now - t >= ttl]:
                del _CACHE[k]
        while len(_CACHE) > CACHE_MAX:
            _CACHE.popitem(last=False)
    return ip


def _pipe(src: socket.socket, dst: socket.socket, cap: int | None = None) -> int:
    """Copy src -> dst until EOF, or until cap bytes (then cut both ways). Returns bytes sent."""
    sent = 0
    try:
        while chunk := src.recv(65536):
            if cap is not None and sent + len(chunk) > cap:
                dst.sendall(chunk[: cap - sent])
                sent = cap
                break
            dst.sendall(chunk)
            sent += len(chunk)
    except OSError:
        pass
    finally:
        for s in (src, dst):
            try:
                s.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
    return sent


def _serve(conn: socket.socket, connect=socket.create_connection) -> None:
    with conn:
        conn.settimeout(5)
        try:
            hello = conn.recv(_HELLO_MAX)
        except OSError:
            return
        name = sni_of(hello)
        if name not in PASS_NAMES:
            return  # closing is the block
        try:
            client = conn.getpeername()[0]
        except (OSError, IndexError):
            client = "?"
        cap = _allowance(client, time.monotonic())
        if not cap:
            return  # this device used its budget for this window
        try:
            up = connect((name, 443), timeout=5)  # dial by name: a spoofed dest IP can't steer us
        except OSError:
            return
        with up:
            conn.settimeout(None)
            up.sendall(hello)
            got: list[int] = []
            t = threading.Thread(target=lambda: got.append(_pipe(up, conn, cap)), daemon=True)
            t.start()
            _pipe(conn, up)
            t.join(60)
            _refund(client, cap - (got[0] if got else cap))


def run_gate(stop: threading.Event, host: str = "0.0.0.0", port: int = GATE_PORT) -> None:
    """Accept redirected :443 connections until stop is set."""
    try:
        srv = socket.create_server((host, port))
    except OSError:
        log.exception(
            "HTTPS gate could not listen on :%s; blocked phones may fall back to mobile data", port
        )
        return
    srv.settimeout(0.5)
    try:
        while not stop.is_set():
            try:
                conn, _ = srv.accept()
            except TimeoutError:
                continue
            threading.Thread(target=_serve, args=(conn,), daemon=True).start()
    finally:
        srv.close()
