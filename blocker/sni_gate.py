"""HTTPS gate for blocked devices: pass only allowlisted hosts (by TLS SNI), close the rest.

Android only treats Wi-Fi as online when https://www.google.com/generate_204 succeeds; without
it a blocked phone silently moves to mobile data. The firewall redirects a blocked device's
non-local :443 traffic here; DNS hands it real addresses only for PASS_NAMES.
Passed connections may carry a probe-sized answer (see TICKET_MAX/REPLY_MAX), nothing readable.
"""

from __future__ import annotations

import logging
import socket
import threading
import time

log = logging.getLogger(__name__)

PASS_NAMES = frozenset({"www.google.com"})
# Once the client sends its first application-data record (its TLS Finished + request), the server
# may send only this much application data, judged by record length (measured 2026-11-12 on the
# beta box): Android's probe gets a 559 B session ticket record, then a 220 B "204 No Content"
# (curl/OpenSSL tickets: 583-595 B). The smallest readable www.google.com reply seen is ~790 B
# (a 1-byte Range of robots.txt); suggest/search replies are 1.2 KB and up.
# One ticket record (<= TICKET_MAX) is allowed only when the client offered TLS 1.3 with
# psk_dhe_ke AND the server picked TLS 1.3; otherwise no ticket comes and a reply could pose as
# one. Everything else shares REPLY_MAX bytes, however it is split into records. The record that
# would overrun is not forwarded, so the client gets no plaintext from it. DOWN_CAP bounds the
# whole connection (the handshake itself is ~4 KB).
TICKET_MAX = 768
REPLY_MAX = 400
DOWN_CAP = 8 * 1024
_APP_DATA = 23
_PSK_MODES, _VERSIONS = 45, 43  # ClientHello/ServerHello extensions
_PSK_DHE_KE, _TLS13 = 1, b"\x03\x04"

# Android re-probes a blocked Wi-Fi about every 10-20 s (GMS forces re-evaluation; measured ~5
# probe connections/min, bursts of 3 in 10 s, ~1 KB each resumed, ~5 KB with a full handshake).
# Per device per WINDOW: at most WINDOW_CONNS passed connections and WINDOW_BYTES down, so
# allowances can't be summed across many connections; 4-6x the probe's need.
WINDOW = 60.0
WINDOW_CONNS = 30
WINDOW_BYTES = 64 * 1024
PER_CLIENT = 4  # concurrent passed connections per device
MAX_CONNS = 64  # concurrent gate connections overall (each passed one uses 2 threads)
LIFETIME = 15.0  # the probe is done in ~1 s
IDLE = 5.0
_use: dict[str, list[float]] = {}  # client ip -> [window start, conns, bytes, open now]
_use_lock = threading.Lock()

GATE_PORT = 8443
_HELLO_MAX = 16384


def _roll(u: list[float], now: float) -> None:
    if now - u[0] >= WINDOW:
        u[0], u[1], u[2] = now, 0, 0


def _admit(client: str, now: float) -> bool:
    """Count a new passed connection against the client's window; False = refuse it."""
    with _use_lock:
        u = _use.setdefault(client, [now, 0, 0, 0])
        _roll(u, now)
        if u[1] >= WINDOW_CONNS or u[2] >= WINDOW_BYTES or u[3] >= PER_CLIENT:
            return False
        u[1] += 1
        u[3] += 1
        return True


def _release(client: str) -> None:
    with _use_lock:
        if client in _use:
            _use[client][3] = max(0, _use[client][3] - 1)


def _charge(client: str, n: int, now: float) -> bool:
    """Spend n bytes of the client's window; False (nothing spent) if that would overrun it."""
    with _use_lock:
        u = _use.setdefault(client, [now, 0, 0, 0])
        _roll(u, now)
        if u[2] + n > WINDOW_BYTES:
            return False
        u[2] += n
        return True


def _extensions(rec: bytes, server: bool = False) -> dict[int, bytes]:
    """Extensions of a TLS ClientHello (or ServerHello) record; {} if it isn't one."""
    exts: dict[int, bytes] = {}
    try:
        if rec[0] != 0x16 or rec[5] != (2 if server else 1):  # handshake record, *Hello
            return exts
        p = 9 + 2 + 32  # record(5) + handshake hdr(4), version, random
        p += 1 + rec[p]  # session id
        if server:
            p += 2 + 1  # chosen cipher suite, compression method
        else:
            p += 2 + int.from_bytes(rec[p : p + 2], "big")  # cipher suites
            p += 1 + rec[p]  # compression methods
        end = p + 2 + int.from_bytes(rec[p : p + 2], "big")
        p += 2
        while p + 4 <= end:
            kind = int.from_bytes(rec[p : p + 2], "big")
            size = int.from_bytes(rec[p + 2 : p + 4], "big")
            exts[kind] = rec[p + 4 : p + 4 + size]
            p += 4 + size
    except IndexError:
        pass  # truncated: keep what was read
    return exts


def sni_of(hello: bytes) -> str | None:
    """Server name from a TLS ClientHello record, or None if absent/unparsable."""
    sni = _extensions(hello).get(0)  # server_name: list len(2), type(1), name len(2), name
    if not sni:
        return None
    try:
        return sni[5 : 5 + int.from_bytes(sni[3:5], "big")].decode("ascii").lower().rstrip(".")
    except UnicodeDecodeError:
        return None


def offers_ticket(hello: bytes) -> bool:
    """ClientHello offers TLS 1.3 and (EC)DHE resumption, so a TLS 1.3 server sends a ticket."""
    exts = _extensions(hello)
    versions = exts.get(_VERSIONS, b"")  # len(1), then 2-byte versions
    tls13 = any(versions[i : i + 2] == _TLS13 for i in range(1, len(versions) - 1, 2))
    return tls13 and _PSK_DHE_KE in exts.get(_PSK_MODES, b"")[1:]


def picked_tls13(server_hello: bytes) -> bool:
    return _extensions(server_hello, server=True).get(_VERSIONS) == _TLS13


_CACHE: dict[str, tuple[float, str]] = {}


def real_ip(name: str, ttl: float = 60) -> str | None:
    """Upstream IPv4 for a PASS_NAMES host via the box's own resolver (cached ttl seconds)."""
    hit = _CACHE.get(name)
    if hit and time.monotonic() - hit[0] < ttl:
        return hit[1]
    try:
        ip = str(socket.getaddrinfo(name, 443, socket.AF_INET, socket.SOCK_STREAM)[0][4][0])
    except OSError:
        log.warning("resolving %s failed", name)
        return None
    _CACHE[name] = (time.monotonic(), ip)
    return ip


def _records(src: socket.socket, buf: bytes = b""):
    """Yield whole TLS records (header included) read from src, starting with buf, until EOF."""
    while True:
        while len(buf) >= 5 and len(buf) >= 5 + (n := int.from_bytes(buf[3:5], "big")):
            yield buf[: 5 + n]
            buf = buf[5 + n :]
        if not (chunk := src.recv(65536)):
            return
        buf += chunk


def _close(*socks: socket.socket) -> None:
    for s in socks:
        try:
            s.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass


def _pipe_up(conn: socket.socket, up: socket.socket, hello: bytes, asked: threading.Event) -> None:
    """Client -> server. Flags the client's first application-data record before it leaves."""
    try:
        for rec in _records(conn, hello):
            if rec[0] == _APP_DATA:
                asked.set()
            up.sendall(rec)
    except OSError:
        pass
    finally:
        _close(conn, up)


def _pipe_down(
    up: socket.socket, conn: socket.socket, asked: threading.Event, ticket: bool, client: str
) -> None:
    """Server -> client, whole records only; cut at the first record the limits don't allow."""
    first, reply_left, sent = True, REPLY_MAX, 0
    try:
        for rec in _records(up):
            if first:
                first, ticket = False, ticket and picked_tls13(rec)
            if rec[0] == _APP_DATA and asked.is_set():
                if ticket:  # the server's first record after the client's Finished
                    ticket = False
                    if len(rec) > TICKET_MAX:
                        break
                else:
                    reply_left -= len(rec)
                    if reply_left < 0:
                        break
            sent += len(rec)
            if sent > DOWN_CAP or not _charge(client, len(rec), time.monotonic()):
                break
            conn.sendall(rec)
    except OSError:
        pass
    finally:
        _close(up, conn)


def _serve(conn: socket.socket, connect=socket.create_connection) -> None:
    socks = [conn]
    timer = threading.Timer(LIFETIME, lambda: _close(*socks))  # hard lifetime, idle or not
    timer.start()
    try:
        with conn:
            _serve_open(conn, connect, socks)
    finally:
        timer.cancel()


def _serve_open(conn: socket.socket, connect, socks: list[socket.socket]) -> None:
    conn.settimeout(IDLE)
    try:
        hello = conn.recv(_HELLO_MAX)
        # a big ClientHello (post-quantum key share) can span TCP segments: read all of it
        while 5 <= len(hello) < min(_HELLO_MAX, 5 + int.from_bytes(hello[3:5], "big")):
            if not (more := conn.recv(_HELLO_MAX)):
                break
            hello += more
    except OSError:
        return
    name = sni_of(hello)
    if name not in PASS_NAMES:
        return  # closing is the block
    try:
        client = conn.getpeername()[0]
    except (OSError, IndexError):
        client = "?"
    if not _admit(client, time.monotonic()):
        return  # this device is over its window budget or concurrency cap
    try:
        try:
            up = connect((name, 443), timeout=IDLE)  # by name: a spoofed dest IP can't steer us
        except OSError:
            return
        with up:
            socks.append(up)
            up.settimeout(IDLE)
            asked = threading.Event()
            t = threading.Thread(
                target=_pipe_down, args=(up, conn, asked, offers_ticket(hello), client), daemon=True
            )
            t.start()
            _pipe_up(conn, up, hello, asked)
            t.join(LIFETIME)
    finally:
        _release(client)


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
    slots = threading.BoundedSemaphore(MAX_CONNS)

    def serve(conn: socket.socket) -> None:
        try:
            _serve(conn)
        finally:
            slots.release()

    try:
        while not stop.is_set():
            try:
                conn, _ = srv.accept()
            except TimeoutError:
                continue
            if not slots.acquire(blocking=False):
                conn.close()  # full: refuse rather than queue
                continue
            threading.Thread(target=serve, args=(conn,), daemon=True).start()
    finally:
        srv.close()
