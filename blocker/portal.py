"""Captive portal: DNS responder answering with the box IP, HTTP redirect to the kid screen."""

from __future__ import annotations

import logging
import socket
import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

log = logging.getLogger(__name__)


def dns_response(query_wire: bytes, answer_ip: str) -> bytes | None:
    """Answer a genuine A query with answer_ip; AAAA/others get NOERROR with no answer.

    Returns None (drop) for responses, non-zero opcodes, qdcount != 1 or unparsable input.
    """
    from blocker.scapy_lite import DNS, DNSRR

    try:
        q = DNS(query_wire)
        if q.qr != 0 or q.opcode != 0 or q.qdcount != 1:
            return None
    except Exception:
        log.debug("dropping unparsable DNS packet", exc_info=True)
        return None
    try:
        first = q.qd[0]
    except (TypeError, IndexError):
        first = q.qd
    answers = []
    if first.qtype == 1:
        answers.append(DNSRR(rrname=first.qname, type="A", ttl=30, rdata=answer_ip))
    resp = DNS(id=q.id, qr=1, aa=1, rd=q.rd, ra=1, rcode=0, qd=[first], an=answers)
    return bytes(resp)


def qname_of(wire: bytes) -> str | None:
    """First question name of a DNS packet (e.g. "example.com."), or None if unparsable."""
    from blocker.scapy_lite import DNS

    try:
        q = DNS(wire)
        qd = q.qd
        first = qd[0] if isinstance(qd, list) else qd
        name = first.qname
        return name.decode() if isinstance(name, bytes) else str(name)
    except Exception:  # noqa: BLE001 - any parse failure just means "no name"
        return None


def handle_query(
    data: bytes,
    addr: tuple[str, int],
    box_ip: str,
    on_query: Callable[[str, str], None] | None = None,
) -> bytes | None:
    """Per-packet work: report the qname to on_query (errors swallowed), return the reply."""
    if addr[1] == 53:
        return None
    out = dns_response(data, box_ip)
    if out is not None and on_query is not None:
        try:
            name = qname_of(data)
            if name:
                on_query(addr[0], name)
        except Exception:
            log.debug("on_query failed", exc_info=True)
    return out


HW_WORKERS = 8  # homework lookups waiting on upstream at once
HW_PER_CLIENT = 4  # in-flight homework lookups per client before we drop


def run_dns(
    cfg,
    box_ip: str,
    stop,
    handle=None,
    claims=None,
    bind=("0.0.0.0", 53),
    client_key=None,
    on_query: Callable[[str, str], None] | None = None,
) -> None:
    """Serve dns_response over UDP :53 until stop (threading.Event) is set.

    handle(client_ip, data) -> bytes | None may forward upstream (slow). Clients for which
    claims(client_ip) is true are served by a bounded worker pool (per-client cap; excess
    is dropped and the client retries); everyone else gets the portal answer inline and
    never waits on upstream. Without claims, handle runs inline (legacy/tests).
    client_key(client_ip) -> MAC | None keys the per-client cap (falls back to the IP), so a
    device can't multiply its budget by changing source IPs.
    on_query(client_ip, qname) sees every name that gets the portal answer (bypass alerts).
    """
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(bind)
    sock.settimeout(0.5)
    pool = ThreadPoolExecutor(max_workers=HW_WORKERS, thread_name_prefix="hw-dns")
    inflight: dict[str, int] = {}
    guard = threading.Lock()

    def answer(addr, data) -> None:
        try:
            out = handle(addr[0], data) if handle else None
            if out is None:
                out = handle_query(data, addr, box_ip, on_query)
            if out is not None:
                sock.sendto(out, addr)
        except Exception:
            log.debug("DNS handling failed", exc_info=True)

    def key_for(ip: str) -> str:
        try:
            return (client_key(ip) if client_key else None) or ip
        except Exception:
            log.debug("client_key failed", exc_info=True)
            return ip

    def work(key, addr, data) -> None:
        try:
            answer(addr, data)
        finally:
            with guard:
                inflight[key] -= 1
                if not inflight[key]:
                    del inflight[key]

    try:
        while not stop.is_set():
            try:
                data, addr = sock.recvfrom(512)
            except TimeoutError:
                continue
            try:
                slow = handle is not None and claims is not None and claims(addr[0])
            except Exception:
                log.debug("claims failed", exc_info=True)
                continue
            if not slow:
                if claims is not None:  # pool mode: unclaimed clients never touch upstream
                    out = handle_query(data, addr, box_ip, on_query)
                    if out is not None:
                        sock.sendto(out, addr)
                else:
                    answer(addr, data)
                continue
            key = key_for(addr[0])
            with guard:
                if inflight.get(key, 0) >= HW_PER_CLIENT:
                    continue  # client floods: drop, it will retry
                inflight[key] = inflight.get(key, 0) + 1
            pool.submit(work, key, addr, data)
    finally:
        pool.shutdown(wait=False, cancel_futures=True)
        sock.close()


class PortalHTTP(BaseHTTPRequestHandler):
    """Redirect every request (including OS captive-check hosts) to the kid screen."""

    config = None
    timeout = 5
    on_hit = None  # Callable[[str], None] | None; set as a staticmethod

    def _redirect(self):
        hit = type(self).on_hit
        if hit is not None:
            try:
                hit(self.client_address[0])
            except Exception:
                log.debug("on_hit failed", exc_info=True)
        self.send_response(302)
        self.send_header("Location", self.config.portal_redirect_url)
        self.send_header("Content-Length", "0")
        self.end_headers()

    do_GET = do_HEAD = do_POST = do_PUT = do_DELETE = do_OPTIONS = _redirect

    def log_message(self, format, *args):
        pass


def run_http(cfg, stop, on_hit=None) -> None:
    """Serve PortalHTTP on :80 until stop (threading.Event) is set."""
    handler = type(
        "Handler",
        (PortalHTTP,),
        {"config": cfg, "on_hit": staticmethod(on_hit) if on_hit else None},
    )
    srv = ThreadingHTTPServer(("0.0.0.0", 80), handler)
    srv.daemon_threads = True
    threading.Thread(target=lambda: (stop.wait(), srv.shutdown()), daemon=True).start()
    try:
        srv.serve_forever()
    finally:
        srv.server_close()
