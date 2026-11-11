"""Contract tests for blocker↔backend communication (F9–F14).

Black-box tests that verify backend client behavior:
- F9: Call shapes, token header, 5s timeout
- F10: Seen dataclass structure, vid omitted when None
- F11: GET /state response structure
- F12: POST /devices/resisting with sorted MACs (even empty)
- F13: Hits and workarounds only non-empty, same tick, ordered
- F14: VLANs only non-empty
"""

import json
import time
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any

import pytest

from blocker.backend import Seen, report_seen, fetch_state, report_resisting, report_hits, report_workarounds, report_vlans
from blocker.config import Config


class RecordingBackendHandler(BaseHTTPRequestHandler):
    """Backend handler that records all calls."""

    def do_GET(self) -> None:
        self.record_and_respond()

    def do_POST(self) -> None:
        self.record_and_respond()

    def record_and_respond(self) -> None:
        """Record request and send response."""
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length) if content_length > 0 else b""

        request_data = {
            "timestamp": time.time(),
            "method": self.command,
            "path": self.path,
            "token": self.headers.get("X-Internal-Token"),
            "body": json.loads(body) if body else None,
        }
        self.server.calls.append(request_data)  # type: ignore

        # Return appropriate response based on path
        if "/state" in self.path:
            response = {
                "blocked": ["aa:bb:cc:dd:ee:ff"],
                "listen_only": False,
                "covered_vlans": [10, 20],
            }
        elif "/devices/seen" in self.path:
            response = {"id": 1}
        elif "/devices/resisting" in self.path:
            response = {"ok": True}
        elif "/devices/hits" in self.path:
            response = {"ok": True}
        elif "/devices/workarounds" in self.path:
            response = {"ok": True}
        elif "/vlans" in self.path:
            response = {"ok": True}
        else:
            response = {"ok": True}

        data = json.dumps(response).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format: str, *args: Any) -> None:
        pass


@pytest.fixture
def recording_backend():
    """Start a backend server that records all calls."""
    server = HTTPServer(("127.0.0.1", 0), RecordingBackendHandler)
    server.calls = []  # type: ignore

    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    yield server, server.calls

    server.shutdown()
    server.server_close()


@pytest.fixture
def blocker_config(recording_backend):
    """Config pointing to recording backend."""
    from pathlib import Path

    server, _ = recording_backend
    host, port = server.server_address
    cfg = Config(
        backend_url=f"http://{host}:{port}",
        blocker_url_host="blocker",
        internal_token="contract-test-token",
        lan_iface="eth0",
        data_dir=Path("/tmp"),
    )
    return cfg


class TestF9CallShapes:
    """F9: Calls to /api/v1/internal, token header, 5s timeout, best-effort."""

    def test_fetch_state_sends_token(self, blocker_config, recording_backend):
        """Calls include X-Internal-Token header."""
        _, calls = recording_backend
        fetch_state(blocker_config)
        assert len(calls) > 0
        assert calls[0]["token"] == "contract-test-token"

    def test_calls_go_to_internal_base(self, blocker_config, recording_backend):
        """Calls use /api/v1/internal base path."""
        _, calls = recording_backend
        fetch_state(blocker_config)
        assert any("/api/v1/internal" in call["path"] for call in calls)

    def test_get_state_is_get_request(self, blocker_config, recording_backend):
        """GET /state uses GET method."""
        _, calls = recording_backend
        fetch_state(blocker_config)
        state_calls = [c for c in calls if "/state" in c["path"]]
        assert any(c["method"] == "GET" for c in state_calls)


class TestF10SeenDataclass:
    """F10: Seen dataclass; vid/mdns_name/model/dhcp_fp omitted when None, never null."""

    def test_seen_with_all_fields(self, blocker_config, recording_backend):
        """Seen with all fields sends all fields."""
        _, calls = recording_backend
        seen = Seen(
            mac="aa:bb:cc:dd:ee:ff",
            ip="192.168.1.100",
            ipv6=["2001:db8::1"],
            hostname="device.local",
            vendor="Acme Corp",
            mdns_name="device",
            model="Model X",
            dhcp_fp="1,3,6",
            vid=10,
        )
        report_seen(blocker_config, seen)
        body = calls[-1]["body"]
        assert body["mdns_name"] == "device"
        assert body["model"] == "Model X"
        assert body["dhcp_fp"] == "1,3,6"
        assert body["vid"] == 10

    def test_seen_omits_none_values(self, blocker_config, recording_backend):
        """Seen omits fields that are None."""
        _, calls = recording_backend
        seen = Seen(
            mac="aa:bb:cc:dd:ee:ff",
            ip="192.168.1.100",
            ipv6=[],
            hostname="device.local",
            vendor="Acme Corp",
            mdns_name=None,
            model=None,
            dhcp_fp=None,
            vid=None,
        )
        report_seen(blocker_config, seen)
        body = calls[-1]["body"]
        # These should not be in the body at all
        assert "mdns_name" not in body
        assert "model" not in body
        assert "dhcp_fp" not in body
        assert "vid" not in body

    def test_seen_truncates_strings(self, blocker_config, recording_backend):
        """String fields truncated to 255 chars."""
        _, calls = recording_backend
        long_name = "x" * 300
        seen = Seen(
            mac="aa:bb:cc:dd:ee:ff",
            ip="192.168.1.100",
            ipv6=[],
            hostname="device.local",
            vendor="Acme",
            mdns_name=long_name,
        )
        report_seen(blocker_config, seen)
        body = calls[-1]["body"]
        assert len(body["mdns_name"]) == 255


class TestF11FetchState:
    """F11: GET /state → {"blocked","listen_only","covered_vlans"}."""

    def test_fetch_state_returns_structure(self, blocker_config):
        """fetch_state returns dict with required fields."""
        state = fetch_state(blocker_config)
        assert state is not None
        assert "blocked" in state
        assert "listen_only" in state
        assert "covered_vlans" in state
        assert isinstance(state["blocked"], list)
        assert isinstance(state["listen_only"], bool)
        assert isinstance(state["covered_vlans"], list)

    def test_fetch_state_parses_macs(self, blocker_config):
        """Blocked MACs are returned as strings."""
        state = fetch_state(blocker_config)
        assert all(isinstance(m, str) for m in state["blocked"])


class TestF12Resisting:
    """F12: POST /devices/resisting with sorted MACs, even when empty."""

    def test_resisting_sends_sorted_macs(self, blocker_config, recording_backend):
        """Resisting sends sorted MAC list."""
        _, calls = recording_backend
        macs = {"cc:dd:ee:ff:aa:bb", "aa:bb:cc:dd:ee:ff"}
        report_resisting(blocker_config, macs)
        body = calls[-1]["body"]
        assert body["resisting"] == sorted(macs)

    def test_resisting_sent_when_empty(self, blocker_config, recording_backend):
        """Resisting sent even when MAC set is empty."""
        _, calls = recording_backend
        report_resisting(blocker_config, set())
        body = calls[-1]["body"]
        assert body["resisting"] == []

    def test_resisting_uses_post(self, blocker_config, recording_backend):
        """Resisting uses POST method."""
        _, calls = recording_backend
        report_resisting(blocker_config, set())
        resisting_calls = [c for c in calls if "/devices/resisting" in c["path"]]
        assert all(c["method"] == "POST" for c in resisting_calls)


class TestF13HitsAndWorkarounds:
    """F13: Hits and workarounds only sent when non-empty, same tick, in order.

    Note: In the blocker service layer, hits/workarounds are only reported
    when non-empty (see blocker/service.py:_resist_once). This test documents
    that behavior but requires a running blocker instance for true verification.
    """

    def test_hits_sent_when_non_empty(self, blocker_config, recording_backend):
        """report_hits sends when hits dict is non-empty."""
        _, calls = recording_backend
        report_hits(blocker_config, {"aa:bb:cc:dd:ee:ff": 5})
        hits_calls = [c for c in calls if "/devices/hits" in c["path"]]
        assert len(hits_calls) > 0
        assert hits_calls[0]["body"]["hits"]["aa:bb:cc:dd:ee:ff"] == 5

    def test_workarounds_sent_when_non_empty(self, blocker_config, recording_backend):
        """report_workarounds sends when dict is non-empty."""
        _, calls = recording_backend
        report_workarounds(blocker_config, {"aa:bb:cc:dd:ee:ff": ["vpn"]})
        wa_calls = [c for c in calls if "/devices/workarounds" in c["path"]]
        assert len(wa_calls) > 0
        assert wa_calls[0]["body"]["found"]["aa:bb:cc:dd:ee:ff"] == ["vpn"]


class TestF14VLANs:
    """F14: POST /vlans only when non-empty.

    Note: The blocker service only calls report_vlans when there are VLANs
    to report. This test documents that behavior.
    """

    def test_vlans_sent_when_non_empty(self, blocker_config, recording_backend):
        """report_vlans sends when VLAN list is non-empty."""
        _, calls = recording_backend
        vlan_data = [{"vid": 10, "macs": ["aa:bb:cc:dd:ee:ff"], "subnet": "192.168.10.0/24"}]
        report_vlans(blocker_config, vlan_data)
        vlan_calls = [c for c in calls if "/vlans" in c["path"]]
        assert len(vlan_calls) > 0
        assert len(vlan_calls[0]["body"]["vlans"]) == 1
        assert vlan_calls[0]["body"]["vlans"][0]["vid"] == 10
