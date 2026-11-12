"""Escape-lab canary: logs token hits only. Never fetches, proxies or executes anything."""

import hmac
import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TTL = 7 * 86400
MAX_TOKENS = 100_000
MAX_BODY = 64 * 1024
MAX_TOKEN_LEN = 128
ALLOWED = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.")

_lock = threading.Lock()
_seen: dict[str, list[float]] = {}  # token -> hit timestamps


def route(path: str, secret: str) -> tuple[str, str] | None:
    """Return (kind, token) for /<secret>/t/<tok> or /<secret>/seen/<tok>, else None."""
    path = path.split("?", 1)[0].split("#", 1)[0]
    prefix = "/" + secret + "/"
    # constant-time compare on the secret-length prefix; length is not secret
    if len(path) <= len(prefix) or not hmac.compare_digest(
        path[: len(prefix)].encode(), prefix.encode()
    ):
        return None
    parts = path[len(prefix) :].split("/")
    if len(parts) != 2 or parts[0] not in ("t", "seen"):
        return None
    tok = parts[1]
    if not tok or len(tok) > MAX_TOKEN_LEN or not set(tok) <= ALLOWED:
        return None
    return parts[0], tok


def record(token: str, now: float | None = None) -> int:
    """Store a hit (bounded, expiring) and return the live hit count."""
    now = time.time() if now is None else now
    with _lock:
        for k in (
            [k for k, v in _seen.items() if v[-1] < now - TTL] if len(_seen) >= MAX_TOKENS else []
        ):
            del _seen[k]
        if token not in _seen and len(_seen) >= MAX_TOKENS:
            return 0  # full: drop, still answer
        hits = _seen.setdefault(token, [])
        hits.append(now)
        del hits[:-100]
        return len(hits)


def count(token: str, now: float | None = None) -> int:
    now = time.time() if now is None else now
    with _lock:
        return sum(1 for t in _seen.get(token, []) if t >= now - TTL)


class Handler(BaseHTTPRequestHandler):
    server_version = "canary"
    sys_version = ""

    def log_message(self, *args):  # no default access log (it would leak the secret path)
        pass

    def _reply(self, code: int, body: bytes = b"", ctype: str = "text/plain"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(body)

    def _drain(self):
        try:
            n = min(int(self.headers.get("Content-Length") or 0), MAX_BODY)
        except ValueError:
            n = 0
        if n > 0:
            self.rfile.read(n)  # discarded, never stored

    def _handle(self):
        r = route(self.path, self.server.secret)
        if r is None:
            return self._reply(404)
        self._drain()
        kind, tok = r
        if kind == "seen":
            return self._reply(200, json.dumps({"seen": count(tok)}).encode(), "application/json")
        record(tok)
        line = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "token": tok,
            "method": self.command,
            "path": "/<secret>/t/" + tok,  # never log the secret
            "ip": self.headers.get("CF-Connecting-IP", self.client_address[0]),
            "ua": (self.headers.get("User-Agent") or "")[:200],
        }
        print(json.dumps(line), flush=True)
        self._reply(200, f"canary:{tok}".encode())

    def do_GET(self):
        self._handle()

    def do_POST(self):
        self._handle() if "/seen/" not in self.path else self._reply(404)

    def _no(self):
        self._reply(404)

    do_PUT = do_DELETE = do_PATCH = do_HEAD = do_OPTIONS = _no


def selftest():
    s = "a" * 64
    assert route(f"/{s}/t/abc", s) == ("t", "abc")
    assert route(f"/{s}/seen/abc?x=1", s) == ("seen", "abc")
    for bad in (
        "/",
        "/wrong/t/x",
        f"/{s}",
        f"/{s}/",
        f"/{s}/t/",
        f"/{s}/t/a/b",
        f"/{s}/x/abc",
        f"/{s}/t/a b",
        f"/{s}/t/../x",
        "/" + "b" * 64 + "/t/abc",
        f"/{s}x/t/abc",
    ):
        assert route(bad, s) is None, bad
    assert route(f"/{s}/t/{'a' * 129}", s) is None
    assert record("tok", 1000.0) == 1 and record("tok", 1001.0) == 2
    assert count("tok", 1002.0) == 2 and count("tok", 1000.0 + TTL + 5) == 0
    assert count("nope") == 0
    print("selftest ok")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
        sys.exit(0)
    secret = os.environ.get("CANARY_SECRET", "")
    if len(secret) < 32:
        sys.exit("CANARY_SECRET missing or too short")
    srv = ThreadingHTTPServer(("0.0.0.0", 8080), Handler)
    srv.secret = secret
    srv.daemon_threads = True
    srv.serve_forever()
