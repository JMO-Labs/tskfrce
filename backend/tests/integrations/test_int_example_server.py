"""The example service is copied by developers: its input checks must be safe on their own."""

import importlib.util
import json
import socket
import subprocess
import sys
import time
from pathlib import Path

import pytest

EXAMPLE = Path(__file__).resolve().parents[3] / "examples/integration-hello"


def _module():
    spec = importlib.util.spec_from_file_location("hello_server_t", EXAMPLE / "server.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


hello = _module()


def _raw(port: int, length_header: str | None) -> int:
    """POST /v1/poll with a raw Content-Length header; the response status. The socket times out
    rather than hang if the server waits for a body that never comes."""
    head = "POST /v1/poll HTTP/1.1\r\nHost: x\r\nConnection: close\r\n"
    if length_header is not None:
        head += f"Content-Length: {length_header}\r\n"
    with socket.create_connection(("127.0.0.1", port), timeout=3) as s:
        s.sendall((head + "\r\n").encode())
        return int(s.recv(1024).split()[1])


@pytest.fixture
def port():
    import threading

    server = hello.make_server(0, quiet=True)
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    yield server.server_address[1]
    server.shutdown()
    server.server_close()
    t.join()


@pytest.mark.parametrize("value", [None, "", "abc", "-1", "1e3", str(hello.MAX_BODY + 1)])
def test_bad_content_length_is_400(port, value):
    assert _raw(port, value) == 400


def _install_req(iid: str, secret: str, rid: str) -> tuple[dict, bytes]:
    body = json.dumps({"request_id": rid, "install_id": iid, "secret": secret}).encode()
    ts = int(time.time())
    headers = {
        "X-Tsk-Timestamp": str(ts),
        "X-Tsk-Request-Id": rid,
        "X-Tsk-Install": iid,
        "X-Tsk-Signature": hello.sign(secret, f"{ts}.{rid}.", body),
    }
    return headers, body


class _RacingLock:
    """A lock that lets another first install win between the secret lookup and the store."""

    def __init__(self, app, iid):
        self.app, self.iid, self.n = app, iid, 0
        self.inner = __import__("threading").Lock()

    def __enter__(self):
        self.inner.acquire()
        self.n += 1
        if self.n == 2:
            self.app.secrets[self.iid] = "winner"

    def __exit__(self, *exc):
        self.inner.release()


def test_first_install_race_keeps_the_winner():
    app = hello.Hello()
    app.lock = _RacingLock(app, "i1")
    headers, body = _install_req("i1", "loser", "r1")
    with pytest.raises(hello.Unauthorized):
        app.verify("install", headers, body)
    assert app.secrets["i1"] == "winner"


def test_reinstall_with_same_secret_still_works():
    app = hello.Hello()
    app.verify("install", *_install_req("i1", "s", "r1"))
    app.verify("install", *_install_req("i1", "s", "r2"))
    assert app.secrets["i1"] == "s"


def test_help_works_under_python_OO():  # noqa: N802
    r = subprocess.run(
        [sys.executable, "-OO", str(EXAMPLE / "server.py"), "--help"],
        capture_output=True,
        timeout=30,
    )
    assert r.returncode == 0, r.stderr


def test_readme_says_secrets_are_dev_only():
    readme = (EXAMPLE / "README.md").read_text()
    assert "unbounded" in readme and "development only" in readme
