"""Contract suite fixtures for blocker black-box testing.

These fixtures record API calls and frame captures to verify parity
between Python and Go implementations.
"""

import json
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any
from unittest.mock import MagicMock

import pytest


class FakeBackendHandler(BaseHTTPRequestHandler):
    """Records all requests to the fake backend."""

    def do_GET(self) -> None:
        self.handle_request()

    def do_POST(self) -> None:
        self.handle_request()

    def handle_request(self) -> None:
        """Record request and return a canned response."""
        # Record the request
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length) if content_length > 0 else b""
        token = self.headers.get("X-Internal-Token")

        request_record = {
            "method": self.command,
            "path": self.path,
            "headers": dict(self.headers),
            "token": token,
            "body": body.decode("utf-8") if body else None,
        }
        self.server.requests.append(request_record)  # type: ignore

        # Return a canned response
        response = self.server.responses.get(self.path, {"blocked": [], "ok": True})  # type: ignore
        data = json.dumps(response).encode()

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format: str, *args: Any) -> None:
        pass  # Silence logs


@pytest.fixture
def fake_backend():
    """Start a fake backend server that records requests.

    Usage:
        backend, recorded_requests = fake_backend
        # Make requests to backend
        assert len(recorded_requests) > 0
    """
    server = HTTPServer(("127.0.0.1", 0), FakeBackendHandler)
    server.requests = []  # type: ignore
    server.responses = {  # type: ignore
        "/api/v1/internal/state": {"blocked": [], "listen_only": False, "covered_vlans": []},
    }

    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    yield server, server.requests

    server.shutdown()
    server.server_close()


@pytest.fixture
def blocker_env(fake_backend):
    """Environment variables for blocker pointing to fake backend."""
    server, _ = fake_backend
    host, port = server.server_address
    return {
        "BACKEND_URL": f"http://{host}:{port}",
        "INTERNAL_TOKEN": "test-token-12345",
        "LAN_IFACE": "eth0",
        "DATA_DIR": "/tmp",
        "BLOCKER_PORT": "0",  # Use random port
        "BLOCKER_BIND": "127.0.0.1",
        "SCAN_INTERVAL": "60",
        "RECONCILE_INTERVAL": "30",
        "RESIST_INTERVAL": "15",
    }


class FrameCapture:
    """Record captured frames for assertion."""

    def __init__(self):
        self.frames: list[dict[str, Any]] = []

    def add_frame(self, frame_type: str, data: dict[str, Any]) -> None:
        """Record a frame with timestamp."""
        self.frames.append(
            {
                "timestamp": time.time(),
                "type": frame_type,
                "data": data,
            }
        )

    def get_by_type(self, frame_type: str) -> list[dict[str, Any]]:
        """Get all frames of a given type."""
        return [f["data"] for f in self.frames if f["type"] == frame_type]

    def clear(self) -> None:
        """Clear recorded frames."""
        self.frames.clear()


@pytest.fixture
def frame_capture():
    """Fixture for recording network frames in tests."""
    return FrameCapture()
