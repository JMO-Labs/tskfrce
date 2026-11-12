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
PER_SOURCE = 8  # open gate connections per source IP, checked at accept
MAX_CONNS = 64  # concurrent gate connections overall (each passed one uses 2 threads)
HELLO_DEADLINE = 3.0  # the whole ClientHello must be in by then
LIFETIME = 15.0  # the probe is done in ~1 s
IDLE = 5.0
_use: dict[str, list[float]] = {}  # client ip -> [window start, conns, bytes]
_use_lock = threading.Lock()

GATE_PORT = 8443
_HELLO_MAX = 16384


def _roll(u: list[float], now: float) -> None:
    if now - u[0] >= WINDOW:
        u[0], u[1], u[2] = now, 0, 0


def _admit(client: str, now: float) -> bool:
    """Count a new passed connection against the client's window; False = refuse it."""
    with _use_lock:
        u = _use.setdefault(client, [now, 0, 0])
        _roll(u, now)
        if u[1] >= WINDOW_CONNS or u[2] >= WINDOW_BYTES:
            return False
        u[1] += 1
        return True


def _charge(client: str, n: int, now: float) -> bool:
    """Spend n bytes of the client's window; False (nothing spent) if that would overrun it."""
    with _use_lock:
        u = _use.setdefault(client, [now, 0, 0])
        _roll(u, now)
        if u[2] + n > WINDOW_BYTES:
            return False
        u[2] += n
        return True


class _Bad(Exception):
    """Malformed hello: fail closed."""


def _u16(b: bytes, i: int) -> int:
    if i + 2 > len(b):
        raise _Bad
    return int.from_bytes(b[i : i + 2], "big")


def _hello_end(buf: bytes) -> int | None:
    """Offset just past the TLS records that complete the first handshake message in buf;
    0 = need more bytes, None = buf doesn't start with handshake records."""
    msg, p = b"", 0
    while len(buf) - p >= 5:
        if buf[p] != 0x16:
            return None
        n = _u16(buf, p + 3)
        if len(buf) - p - 5 < n:
            return 0
        msg += buf[p + 5 : p + 5 + n]
        p += 5 + n
        if len(msg) >= 4 and len(msg) >= 4 + int.from_bytes(msg[1:4], "big"):
            return p
    return 0


def _client_hello(raw: bytes) -> bytes:
    """Body of the ClientHello carried by raw, which must be whole handshake records (as a
    server reassembles them: a hello may span records) holding exactly that one message."""
    msg, p = b"", 0
    while p < len(raw):
        if raw[p] != 0x16 or len(raw) - p < 5:
            raise _Bad
        n = _u16(raw, p + 3)
        if not 0 < n <= 16384 or p + 5 + n > len(raw):
            raise _Bad
        msg += raw[p + 5 : p + 5 + n]
        p += 5 + n
    if len(msg) < 4 or msg[0] != 1 or len(msg) != 4 + int.from_bytes(msg[1:4], "big"):
        raise _Bad
    return msg[4:]


def _hello_exts(body: bytes, server: bool = False) -> dict[int, bytes]:
    """Extensions of a ClientHello/ServerHello body, strictly within the declared lengths."""
    p = 2 + 32  # version, random
    if p >= len(body) or body[p] > 32:
        raise _Bad
    p += 1 + body[p]  # session id
    if server:
        p += 2 + 1  # chosen cipher suite, compression method
    else:
        n = _u16(body, p)
        if n == 0 or n % 2:
            raise _Bad
        p += 2 + n  # cipher suites
        if p >= len(body) or body[p] == 0:
            raise _Bad
        p += 1 + body[p]  # compression methods
    end = p + 2 + _u16(body, p)
    if end != len(body):
        raise _Bad
    p += 2
    exts: dict[int, bytes] = {}
    while p < end:
        kind, n = _u16(body, p), _u16(body, p + 2)
        if kind in exts or p + 4 + n > end:
            raise _Bad
        exts[kind] = body[p + 4 : p + 4 + n]
        p += 4 + n
    return exts


def _client_exts(raw: bytes) -> dict[int, bytes] | None:
    try:
        return _hello_exts(_client_hello(raw))
    except _Bad:
        return None


def _vector(data: bytes, width: int = 1) -> bytes:
    """Contents of a length-prefixed vector that must fill data exactly."""
    if len(data) < width or int.from_bytes(data[:width], "big") != len(data) - width:
        raise _Bad
    return data[width:]


def sni_of(hello: bytes) -> str | None:
    """Server name from a ClientHello's TLS records; None if absent, ambiguous or malformed."""
    exts = _client_exts(hello)
    if exts is None or 0 not in exts:
        return None
    try:
        lst, p, names = _vector(exts[0], 2), 0, []
        while p < len(lst):  # entries: type(1), len(2), name
            n = _u16(lst, p + 1)
            if p + 3 + n > len(lst):
                raise _Bad
            if lst[p] == 0:
                names.append(lst[p + 3 : p + 3 + n])
            p += 3 + n
        if len(names) != 1:
            raise _Bad
        return names[0].decode("ascii").lower().rstrip(".")
    except (_Bad, UnicodeDecodeError):
        return None


def offers_ticket(hello: bytes) -> bool:
    """ClientHello offers TLS 1.3 and (EC)DHE resumption, so a TLS 1.3 server sends a ticket."""
    exts = _client_exts(hello)
    if exts is None or sni_of(hello) is None:
        return False
    try:
        versions = _vector(exts.get(_VERSIONS, b""))
        modes = _vector(exts.get(_PSK_MODES, b""))
    except _Bad:
        return False
    if len(versions) % 2:
        return False
    tls13 = any(versions[i : i + 2] == _TLS13 for i in range(0, len(versions), 2))
    return tls13 and _PSK_DHE_KE in modes


def picked_tls13(rec: bytes) -> bool:
    """The server's first record is a ServerHello choosing TLS 1.3."""
    try:
        if rec[0] != 0x16 or rec[5] != 2:
            return False
        body = rec[9 : 9 + int.from_bytes(rec[6:9], "big")]
        return _hello_exts(body, server=True).get(_VERSIONS) == _TLS13
    except (_Bad, IndexError):
        return False


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


def _read_hello(conn: socket.socket) -> tuple[bytes, bytes] | None:
    """(the TLS records holding the ClientHello, any bytes after them), read whole however TCP
    splits them, before HELLO_DEADLINE; None if it isn't a handshake or doesn't arrive in time."""
    deadline, buf = time.monotonic() + HELLO_DEADLINE, b""
    try:
        while not (end := _hello_end(buf)):
            if end is None or len(buf) >= _HELLO_MAX:
                return None
            left = deadline - time.monotonic()
            if left <= 0:
                return None
            conn.settimeout(left)
            if not (chunk := conn.recv(_HELLO_MAX)):
                return None
            buf += chunk
    except (OSError, _Bad):
        return None
    return buf[:end], buf[end:]


def _serve_open(conn: socket.socket, connect, socks: list[socket.socket]) -> None:
    got = _read_hello(conn)
    if got is None:
        return
    hello, rest = got
    name = sni_of(hello)
    if name not in PASS_NAMES:
        return  # closing is the block (malformed hellos land here too)
    try:
        client = conn.getpeername()[0]
    except (OSError, IndexError):
        client = "?"
    if not _admit(client, time.monotonic()):
        return  # this device is over its window budget
    try:
        up = connect((name, 443), timeout=IDLE)  # by name: a spoofed dest IP can't steer us
    except OSError:
        return
    with up:
        socks.append(up)
        conn.settimeout(IDLE)
        up.settimeout(IDLE)
        asked = threading.Event()
        t = threading.Thread(
            target=_pipe_down, args=(up, conn, asked, offers_ticket(hello), client), daemon=True
        )
        t.start()
        _pipe_up(conn, up, hello + rest, asked)
        t.join(LIFETIME)


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
    open_by: dict[str, int] = {}
    lock = threading.Lock()

    def done(ip: str) -> None:
        with lock:
            open_by[ip] -= 1
            if not open_by[ip]:
                del open_by[ip]

    def serve(conn: socket.socket, ip: str) -> None:
        try:
            _serve(conn)
        finally:
            slots.release()
            done(ip)

    try:
        while not stop.is_set():
            try:
                conn, addr = srv.accept()
            except TimeoutError:
                continue
            ip = addr[0]
            with lock:  # per-source cap first, so one device can't take the shared slots
                full = open_by.get(ip, 0) >= PER_SOURCE
                if not full:
                    open_by[ip] = open_by.get(ip, 0) + 1
            if full:
                conn.close()
                continue
            if not slots.acquire(blocking=False):
                done(ip)
                conn.close()  # full: refuse rather than queue
                continue
            threading.Thread(target=serve, args=(conn, ip), daemon=True).start()
    finally:
        srv.close()
