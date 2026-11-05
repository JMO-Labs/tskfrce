"""Hello example: a complete t@sk4ce v1 integration service in one stdlib-only file.

Copy it to start your own. It shows every rule a service must follow
(docs/integrations/protocol-v1.md):

- verify each request: timestamp within 300 s, a valid signature, a request id not seen before;
- sign each reply over its exact bytes and echo the request id;
- answer actions with stable idempotency keys.

What it does: every poll marks each linked chore done ("always done"), and the parent card
counts polls and has a "Mark done" button.

    python examples/integration-hello/server.py --port 8787

Secrets live in memory only, so a restart forgets every install. A real service must store
them encrypted, serve HTTPS on port 443 and keep seen request ids across restarts.
"""

import argparse
import hashlib
import hmac
import json
import threading
import time
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SKEW = 300  # seconds of clock difference the protocol allows, either way
SEEN_FOR = 2 * SKEW  # keep request ids at least this long; older ones fail the skew check
MAX_BODY = 1_048_576  # the box sends at most 50 small events; refuse anything huge
MAX_ACTIONS = 20  # per reply


class Unauthorized(Exception):
    """The request failed verification: answer 401 and do no work."""


def sign(secret: str, prefix: str, body: bytes) -> str:
    """v1=<hex HMAC-SHA256 of prefix + body>, the protocol's signature format."""
    return "v1=" + hmac.new(secret.encode(), prefix.encode() + body, hashlib.sha256).hexdigest()


class Hello:
    """Per-install state and the five endpoints. Thread-safe: the server is threaded."""

    def __init__(self, check_replay: bool = True):
        self.check_replay = check_replay  # off only to show what the simulator catches
        self.secrets: dict[str, str] = {}  # install_id -> secret
        self.polls: dict[str, int] = {}  # install_id -> polls answered
        self.seen: dict[str, float] = {}  # request_id -> when first verified
        self.lock = threading.Lock()

    def verify(self, path: str, headers, body: bytes) -> tuple[dict, str]:
        """(the parsed request, the install secret), or Unauthorized.
        Order: skew, then signature, then replay, so unsigned junk never fills the seen list."""
        try:
            ts = int(headers["X-Tsk-Timestamp"])
            rid, iid = headers["X-Tsk-Request-Id"], headers["X-Tsk-Install"]
            got = headers["X-Tsk-Signature"]
            req = json.loads(body)
        except (KeyError, TypeError, ValueError) as e:
            raise Unauthorized("malformed") from e
        if not isinstance(req, dict):
            raise Unauthorized("malformed")
        if abs(time.time() - ts) > SKEW:
            raise Unauthorized("stale timestamp")
        with self.lock:
            secret = self.secrets.get(iid)
        if path == "install" and secret is None:
            # install carries the new secret, and is signed with it. Never let a later install
            # replace a known secret: that would let anyone take over the install.
            secret = req.get("secret")
        if not isinstance(secret, str) or not hmac.compare_digest(
            str(got).encode(), sign(secret, f"{ts}.{rid}.", body).encode()
        ):
            raise Unauthorized("bad signature")
        if req.get("request_id") != rid or req.get("install_id") != iid:
            raise Unauthorized("body does not match headers")
        with self.lock:
            now = time.time()
            self.seen = {k: t for k, t in self.seen.items() if now - t < SEEN_FOR}
            if self.check_replay and rid in self.seen:
                raise Unauthorized("replayed request id")
            self.seen[rid] = now
            if path == "install":
                self.secrets[iid] = secret
                self.polls.setdefault(iid, 0)
        return req, secret

    def reply(self, path: str, req: dict) -> dict:
        iid = req["install_id"]
        if path == "poll":
            with self.lock:
                self.polls[iid] = self.polls.get(iid, 0) + 1
            return {"actions": done(req["grant"], [k["id"] for k in req["grant"]["kids"]])}
        if path == "events":
            return {"actions": [a for e in req["events"] for a in on_event(req["grant"], e)]}
        if path == "widgets":
            return {"widgets": card(self.polls.get(iid, 0)) if req["surface"] == "parent" else []}
        if path == "uninstall":
            with self.lock:
                self.secrets.pop(iid, None)
                self.polls.pop(iid, None)
        return {"actions": []} if path == "install" else {}


def done(grant: dict, kid_ids: list[int]) -> list[dict]:
    """chore.complete for each kid and linked chore. The key holds the date, so the box applies
    it once a day however often we repeat it."""
    today = datetime.now(UTC).date().isoformat()
    actions = [
        {
            "type": "chore.complete",
            "idempotency_key": f"{today}:{kid}:{chore['id']}",
            "kid_id": kid,
            "chore_id": chore["id"],
        }
        for kid in kid_ids
        for chore in grant["chores"]
    ]
    return actions[:MAX_ACTIONS]


def on_event(grant: dict, event: dict) -> list[dict]:
    """A press of our "done" button completes that kid's chores (every kid when a parent pressed
    it without choosing one). Other events need no answer."""
    if event.get("kind") != "widget.pressed" or event.get("button_id") != "done":
        return []
    kid = event.get("kid_id")
    return done(grant, [k["id"] for k in grant["kids"]] if kid is None else [kid])


def card(polls: int) -> list[dict]:
    """The declared parent widget "hello". Strings are plain text: the box never renders markup."""
    children = [
        {"type": "text", "text": "Hello from the example integration."},
        {"type": "stat", "label": "Polls", "value": str(polls)},
        {"type": "button", "id": "done", "label": "Mark done", "action": "chore.complete"},
    ]
    return [{"id": "hello", "root": {"type": "card", "title": "Hello", "children": children}}]


ROUTES = {"install", "events", "poll", "widgets", "uninstall"}


def make_server(
    port: int, host: str = "127.0.0.1", check_replay: bool = True, quiet: bool = False
) -> ThreadingHTTPServer:
    app = Hello(check_replay)

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):  # noqa: N802 - the http.server hook name
            path = self.path.removeprefix("/v1/")
            if path not in ROUTES:
                return self.send_error(404)
            size = int(self.headers.get("Content-Length") or 0)
            if size > MAX_BODY:
                return self.send_error(413)
            body = self.rfile.read(size)
            try:
                req, secret = app.verify(path, self.headers, body)
            except Unauthorized as e:
                return self.send_error(401, str(e))
            try:
                answer = app.reply(path, req)
            except (KeyError, TypeError, AttributeError):
                return self.send_error(400, "unexpected request shape")
            rid = req["request_id"]
            out = json.dumps({"request_id": rid, **answer}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(out)))
            # Sign the exact bytes we send, after serializing them. Never re-serialize.
            self.send_header("X-Tsk-Signature", sign(secret, f"{rid}.", out))
            self.end_headers()
            self.wfile.write(out)

        def log_message(self, fmt, *args):
            if not quiet:
                super().log_message(fmt, *args)

    return ThreadingHTTPServer((host, port), Handler)


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--port", type=int, default=8787)
    p.add_argument("--host", default="127.0.0.1")
    a = p.parse_args()
    server = make_server(a.port, a.host)
    print(f"Hello example on http://{a.host}:{a.port}/v1/ (Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
