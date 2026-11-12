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
# may answer with only a few small application-data records, judged by length alone (measured
# 2026-11-12 on the beta box): Android's probe gets a 559 B session ticket, then a 220 B
# "204 No Content" (curl/OpenSSL tickets: 583-595 B). The smallest readable www.google.com reply
# seen is ~790 B (a 1-byte Range of robots.txt); suggest/search replies are 1.2 KB and up.
# A ticket allowance is given only if the ClientHello offers TLS 1.3 (EC)DHE resumption (else the
# server sends none, and a reply could pose as the ticket). Anything more cuts the connection
# before the record reaches the client, so it gets no plaintext from it. DOWN_CAP bounds the rest
# (the handshake itself is ~4 KB).
TICKET_MAX = 768
REPLY_MAX = 400
DOWN_CAP = 8 * 1024
_APP_DATA = 23
_PSK_MODES = 45  # psk_key_exchange_modes extension; servers send tickets only for psk_dhe_ke
_PSK_DHE_KE = 1

GATE_PORT = 8443
_HELLO_MAX = 16384


def _extensions(hello: bytes) -> dict[int, bytes]:
    """Extensions of a TLS ClientHello record ({} if it isn't one or is unparsable)."""
    exts: dict[int, bytes] = {}
    try:
        if hello[0] != 0x16 or hello[5] != 0x01:  # handshake record, ClientHello
            return exts
        p = 9 + 2 + 32  # record(5) + handshake hdr(4), version, random
        p += 1 + hello[p]  # session id
        p += 2 + int.from_bytes(hello[p : p + 2], "big")  # cipher suites
        p += 1 + hello[p]  # compression methods
        end = p + 2 + int.from_bytes(hello[p : p + 2], "big")
        p += 2
        while p + 4 <= end:
            kind = int.from_bytes(hello[p : p + 2], "big")
            size = int.from_bytes(hello[p + 2 : p + 4], "big")
            exts[kind] = hello[p + 4 : p + 4 + size]
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


def reply_limits(hello: bytes) -> list[int]:
    """Max length of each application-data record the server may send after the client's first."""
    modes = _extensions(hello).get(_PSK_MODES, b"")
    return [TICKET_MAX, REPLY_MAX] if _PSK_DHE_KE in modes[1:] else [REPLY_MAX]


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
    up: socket.socket, conn: socket.socket, asked: threading.Event, limits: list[int]
) -> None:
    """Server -> client, whole records only; cut at the first record the limits don't allow."""
    left, sent = list(limits), 0
    try:
        for rec in _records(up):
            if rec[0] == _APP_DATA and asked.is_set() and (not left or len(rec) - 5 > left.pop(0)):
                break
            sent += len(rec)
            if sent > DOWN_CAP:
                break
            conn.sendall(rec)
    except OSError:
        pass
    finally:
        _close(up, conn)


def _serve(conn: socket.socket, connect=socket.create_connection) -> None:
    with conn:
        conn.settimeout(5)
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
            up = connect((name, 443), timeout=5)  # dial by name: a spoofed dest IP can't steer us
        except OSError:
            return
        with up:
            conn.settimeout(None)
            up.settimeout(None)
            asked = threading.Event()
            t = threading.Thread(
                target=_pipe_down, args=(up, conn, asked, reply_limits(hello)), daemon=True
            )
            t.start()
            _pipe_up(conn, up, hello, asked)
            t.join(60)


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
