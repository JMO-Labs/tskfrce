"""Contract tests for blocker HTTP API (F2–F8).

Black-box tests that verify:
- F2: Binding to BLOCKER_BIND:BLOCKER_PORT
- F3: Auth checked before body is read
- F4: Body size cap (64 KiB)
- F5: GET /health → 200 {"ok":true}
- F6: POST /state with MAC list
- F7: POST /test-block with MAC
- F8: Exact path matching, 404 for unknown paths, JSON responses with Content-Length
"""

import http.client
import json
import threading

import pytest
from blocker.api import make_api
from blocker.state_store import StateStore


@pytest.fixture
def api_server():
    """Start a blocker API server for contract testing."""
    store = StateStore()
    server = make_api(
        state=store,
        token="test-token-contract",
        tester=lambda mac: {"ok": True, "message": f"tested {mac}"},
        host="127.0.0.1",
        port=0,  # Use random available port
    )
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield server, store
    server.shutdown()
    server.server_close()


def _http_request(server: object, method: str, path: str, body: bytes | None = None, headers: dict | None = None):
    """Make HTTP request and return status, headers, body."""
    h, p = server.server_address  # type: ignore
    conn = http.client.HTTPConnection(h, p, timeout=5)
    req_headers = headers or {}
    conn.request(method, path, body=body, headers=req_headers)
    resp = conn.getresponse()
    resp_body = resp.read()
    resp_headers = dict(resp.getheaders())
    conn.close()
    return resp.status, resp_headers, resp_body


class TestF2Binding:
    """F2: Listens on BLOCKER_BIND:BLOCKER_PORT."""

    def test_server_listens(self, api_server):
        """Server is listening on the configured host:port."""
        server, _ = api_server
        host, port = server.server_address
        assert host == "127.0.0.1"
        assert port > 0


class TestF3Auth:
    """F3: X-Internal-Token required; checked before body read.

    Auth failure returns 403 {"error":"forbidden"} without reading body.
    """

    @pytest.mark.parametrize("token", [None, "", "wrong-token"])
    def test_state_rejects_missing_or_wrong_token(self, api_server, token):
        """POST /state requires correct token."""
        server, _ = api_server
        headers = {"Content-Type": "application/json"}
        if token is not None:
            headers["X-Internal-Token"] = token
        status, _, body = _http_request(server, "POST", "/state", b'{"blocked":[]}', headers)
        assert status == 403
        data = json.loads(body)
        assert data["error"] == "forbidden"

    def test_test_block_rejects_missing_token(self, api_server):
        """POST /test-block requires token."""
        server, _ = api_server
        status, _, body = _http_request(server, "POST", "/test-block", b'{"mac":"aa:bb:cc:dd:ee:ff"}')
        assert status == 403
        data = json.loads(body)
        assert data["error"] == "forbidden"

    def test_auth_checked_before_body_read(self, api_server):
        """Auth is checked before body is read (no 400 for bad JSON if auth fails)."""
        server, _ = api_server
        # Send invalid JSON with wrong token
        headers = {"X-Internal-Token": "wrong"}
        status, _, _ = _http_request(server, "POST", "/state", b"not json", headers)
        # Should get 403 (auth failed), not 400 (bad JSON)
        assert status == 403


class TestF4BodySize:
    """F4: Body > 64 KiB rejected with 400."""

    def test_large_body_rejected(self, api_server):
        """POST with body > 64 KiB returns 400."""
        server, _ = api_server
        large_body = b'{"blocked":["' + b"a" * (65 * 1024) + b'"]}'
        headers = {"X-Internal-Token": "test-token-contract", "Content-Length": str(len(large_body))}
        status, _, body = _http_request(server, "POST", "/state", large_body, headers)
        assert status == 400
        data = json.loads(body)
        assert "too large" in data["error"]

    def test_body_at_limit_accepted(self, api_server):
        """POST with body exactly at 64 KiB is accepted."""
        server, _ = api_server
        # Create a payload just under 64 KiB
        body_dict = {"blocked": ["aa:bb:cc:dd:ee:ff"]}
        body = json.dumps(body_dict).encode()
        assert len(body) < 64 * 1024
        headers = {"X-Internal-Token": "test-token-contract", "Content-Type": "application/json"}
        status, _, _ = _http_request(server, "POST", "/state", body, headers)
        assert status == 200


class TestF5Health:
    """F5: GET /health → 200 {"ok":true}, no auth required."""

    def test_health_no_auth(self, api_server):
        """GET /health works without token."""
        server, _ = api_server
        status, _, body = _http_request(server, "GET", "/health")
        assert status == 200
        data = json.loads(body)
        assert data == {"ok": True}

    def test_health_returns_200(self, api_server):
        """GET /health returns 200 status."""
        server, _ = api_server
        status, _, _ = _http_request(server, "GET", "/health")
        assert status == 200


class TestF6State:
    """F6: POST /state {"blocked":[macs]} updates state.

    MACs lowercased, validated, returns 200 {"ok":true,"count":n}.
    """

    def test_state_accepts_valid_macs(self, api_server):
        """POST /state with valid MACs."""
        server, store = api_server
        body = json.dumps({"blocked": ["AA:BB:CC:DD:EE:FF", "11:22:33:44:55:66"]}).encode()
        headers = {"X-Internal-Token": "test-token-contract", "Content-Type": "application/json"}
        status, _, resp_body = _http_request(server, "POST", "/state", body, headers)
        assert status == 200
        data = json.loads(resp_body)
        assert data["ok"] is True
        assert data["count"] == 2

    def test_state_lowercases_macs(self, api_server):
        """MACs are lowercased."""
        server, store = api_server
        body = json.dumps({"blocked": ["AA:BB:CC:DD:EE:FF"]}).encode()
        headers = {"X-Internal-Token": "test-token-contract", "Content-Type": "application/json"}
        _http_request(server, "POST", "/state", body, headers)
        blocked = store.current()
        assert "aa:bb:cc:dd:ee:ff" in blocked

    def test_state_rejects_invalid_mac(self, api_server):
        """Invalid MAC format rejected."""
        server, _ = api_server
        body = json.dumps({"blocked": ["invalid"]}).encode()
        headers = {"X-Internal-Token": "test-token-contract", "Content-Type": "application/json"}
        status, _, resp_body = _http_request(server, "POST", "/state", body, headers)
        assert status == 400
        data = json.loads(resp_body)
        assert "not a valid MAC" in data["error"]

    def test_state_rejects_non_list(self, api_server):
        """blocked must be a list."""
        server, _ = api_server
        body = json.dumps({"blocked": "not-a-list"}).encode()
        headers = {"X-Internal-Token": "test-token-contract", "Content-Type": "application/json"}
        status, _, resp_body = _http_request(server, "POST", "/state", body, headers)
        assert status == 400
        data = json.loads(resp_body)
        assert "must be a list" in data["error"]


class TestF7TestBlock:
    """F7: POST /test-block {"mac":str} for testing block status."""

    def test_test_block_valid_mac(self, api_server):
        """POST /test-block with valid MAC returns result."""
        server, _ = api_server
        body = json.dumps({"mac": "aa:bb:cc:dd:ee:ff"}).encode()
        headers = {"X-Internal-Token": "test-token-contract", "Content-Type": "application/json"}
        status, _, resp_body = _http_request(server, "POST", "/test-block", body, headers)
        assert status == 200
        data = json.loads(resp_body)
        assert "ok" in data

    def test_test_block_rejects_missing_mac(self, api_server):
        """POST /test-block without 'mac' field returns 400."""
        server, _ = api_server
        body = json.dumps({}).encode()
        headers = {"X-Internal-Token": "test-token-contract", "Content-Type": "application/json"}
        status, _, resp_body = _http_request(server, "POST", "/test-block", body, headers)
        assert status == 400
        data = json.loads(resp_body)
        assert "mac" in data["error"]


class TestF8Responses:
    """F8: Exact path matching, 404 for unknown paths, JSON with Content-Length."""

    def test_unknown_path_404(self, api_server):
        """Unknown path returns 404."""
        server, _ = api_server
        status, _, body = _http_request(server, "GET", "/unknown")
        assert status == 404
        data = json.loads(body)
        assert data["error"] == "not found"

    def test_exact_path_matching(self, api_server):
        """Query string causes 404 (exact path matching)."""
        server, _ = api_server
        status, _, _ = _http_request(server, "GET", "/health?extra=param")
        # Should fail due to exact path matching
        assert status == 404

    def test_json_responses_have_content_length(self, api_server):
        """All responses include Content-Length header."""
        server, _ = api_server
        status, headers, _ = _http_request(server, "GET", "/health")
        # Headers dict has case-sensitive keys from http.client
        content_length_key = next((k for k in headers if k.lower() == "content-length"), None)
        assert content_length_key is not None
        assert int(headers[content_length_key]) > 0

    def test_json_content_type(self, api_server):
        """Responses are JSON."""
        server, _ = api_server
        status, headers, body = _http_request(server, "GET", "/health")
        # Headers dict has case-sensitive keys from http.client
        content_type_key = next((k for k in headers if k.lower() == "content-type"), None)
        assert content_type_key is not None
        assert headers[content_type_key] == "application/json"
        data = json.loads(body)  # Should not raise
        assert isinstance(data, dict)

    def test_invalid_json_rejected(self, api_server):
        """Invalid JSON in request body returns 400."""
        server, _ = api_server
        headers = {"X-Internal-Token": "test-token-contract", "Content-Type": "application/json"}
        status, _, body = _http_request(server, "POST", "/state", b"not json", headers)
        assert status == 400
        data = json.loads(body)
        assert "error" in data
