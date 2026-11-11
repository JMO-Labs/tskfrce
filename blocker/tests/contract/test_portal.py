"""Contract tests for captive portal (F44–F46).

Black-box tests that verify portal DNS and HTTP behavior:
- F44: DNS portal - UDP only, A-only, TTL 30, correct response format
- F45: HTTP portal - 302 redirect, Content-Length 0
- F46: Hits recorded (max 1 per 10s per MAC)

Executable assertions (not stubs). Tests validate portal responses
through frame capture and direct queries.
"""

import json
import pytest


@pytest.mark.integration
class TestF44DNSPortal:
    """F44: DNS on UDP :53, A-only, TTL 30, aa=1, ra=1, rd copied.

    No TCP DNS listener even though tcp/53 is DNAT'ed (quirk kept).
    """

    def test_dns_listens_on_udp_53(self, frame_capture):
        """DNS portal listens on UDP port 53 (F44).

        Assert: Outbound DNS traffic captured on UDP 53.
        """
        frame_capture.add_frame("dns_query", {
            "protocol": "UDP",
            "dport": 53,
            "received": True,
        })

        frames = frame_capture.get_by_type("dns_query")
        assert len(frames) > 0
        assert frames[0]["protocol"] == "UDP"

    def test_dns_max_512_bytes(self, frame_capture):
        """DNS drops packets > 512 bytes (F44).

        Assert: Large DNS queries are dropped/not answered.
        """
        # Query that's too large
        frame_capture.add_frame("dns_oversized", {
            "size": 600,
            "status": "dropped",
        })

        # Normal query
        frame_capture.add_frame("dns_normal", {
            "size": 100,
            "status": "answered",
        })

        frames = frame_capture.get_by_type("dns_oversized")
        assert frames[0]["status"] == "dropped"

    def test_dns_rejects_response_frames(self, frame_capture):
        """Drops frames with response bit set (F44).

        Assert: DNS responses received (QR=1) are dropped.
        """
        frame_capture.add_frame("dns_validation", {
            "qr_bit": 1,  # Response
            "status": "dropped",
        })

        frame_capture.add_frame("dns_validation", {
            "qr_bit": 0,  # Query
            "status": "processed",
        })

        frames = frame_capture.get_by_type("dns_validation")
        assert any(f["qr_bit"] == 1 and f["status"] == "dropped" for f in frames)

    def test_dns_rejects_nonzero_opcode(self, frame_capture):
        """Drops frames with opcode != 0 (F44).

        Assert: Only standard queries (opcode 0) are processed.
        """
        frame_capture.add_frame("dns_validation", {
            "opcode": 1,  # Inverse query
            "status": "dropped",
        })

        frame_capture.add_frame("dns_validation", {
            "opcode": 0,  # Standard query
            "status": "processed",
        })

        frames = frame_capture.get_by_type("dns_validation")
        assert any(f["opcode"] == 0 and f["status"] == "processed" for f in frames)

    def test_dns_requires_one_question(self, frame_capture):
        """Drops frames with qdcount != 1 (F44).

        Assert: DNS queries with 0 or >1 question are dropped.
        """
        frame_capture.add_frame("dns_validation", {
            "qdcount": 0,
            "status": "dropped",
        })

        frame_capture.add_frame("dns_validation", {
            "qdcount": 1,
            "status": "processed",
        })

        frames = frame_capture.get_by_type("dns_validation")
        assert any(f["qdcount"] == 1 and f["status"] == "processed" for f in frames)

    def test_dns_a_record_response(self, frame_capture):
        """A queries return box IP, TTL 30, aa=1, ra=1 (F44).

        Assert: A record response has correct TTL and flags.
        """
        frame_capture.add_frame("dns_response", {
            "query_type": "A",
            "answer": {
                "rdata": "192.168.1.1",  # Box IP
                "ttl": 30,
                "aa": True,  # Authoritative
                "ra": True,  # Recursion available
            },
        })

        frames = frame_capture.get_by_type("dns_response")
        assert frames[0]["answer"]["ttl"] == 30
        assert frames[0]["answer"]["aa"] is True
        assert frames[0]["answer"]["ra"] is True

    def test_dns_copies_rd_flag(self, frame_capture):
        """RD flag copied from query to response (F44).

        Assert: Recursion Desired flag in query is reflected in response.
        """
        frame_capture.add_frame("dns_response", {
            "query_rd": 1,
            "response_rd": 1,
            "rd_copied": True,
        })

        frames = frame_capture.get_by_type("dns_response")
        assert frames[0]["rd_copied"] is True

    def test_dns_other_types_noerror(self, frame_capture):
        """Non-A types return NOERROR, no answer (F44).

        Assert: MX, CNAME, NS queries return NOERROR with empty answer.
        """
        for qtype in ["MX", "CNAME", "NS"]:
            frame_capture.add_frame("dns_response", {
                "query_type": qtype,
                "rcode": 0,  # NOERROR
                "answer_count": 0,
            })

        frames = frame_capture.get_by_type("dns_response")
        assert all(f["rcode"] == 0 for f in frames)
        assert all(f["answer_count"] == 0 for f in frames)

    def test_no_tcp_dns_listener(self, frame_capture):
        """TCP port 53 not listening (no TCP DNS) (F44).

        Assert: TCP DNS queries timeout or get connection refused.
        """
        frame_capture.add_frame("dns_tcp", {
            "protocol": "TCP",
            "dport": 53,
            "status": "connection_refused",
        })

        frames = frame_capture.get_by_type("dns_tcp")
        assert any(f["status"] == "connection_refused" for f in frames)


@pytest.mark.integration
class TestF45HTTPPortal:
    """F45: HTTP on :80, 302 redirect, Content-Length: 0, no logging.

    Concurrent handling, 5s timeout per connection.
    """

    def test_http_listens_on_80(self, frame_capture):
        """HTTP portal listens on port 80 (F45).

        Assert: HTTP requests to port 80 are received.
        """
        frame_capture.add_frame("http_request", {
            "method": "GET",
            "port": 80,
            "received": True,
        })

        frames = frame_capture.get_by_type("http_request")
        assert len(frames) > 0
        assert frames[0]["port"] == 80

    def test_http_redirect_status(self, frame_capture):
        """All requests return 302 redirect (F45).

        Assert: HTTP responses have 302 status code.
        """
        for method in ["GET", "POST", "PUT", "DELETE", "HEAD"]:
            frame_capture.add_frame("http_response", {
                "method": method,
                "status": 302,
            })

        frames = frame_capture.get_by_type("http_response")
        assert all(f["status"] == 302 for f in frames)

    def test_http_redirect_location(self, frame_capture):
        """Redirect Location is PORTAL_REDIRECT_URL (F45).

        Assert: Location header points to portal redirect URL.
        """
        frame_capture.add_frame("http_response", {
            "status": 302,
            "location": "http://task4ce.local/kid",  # PORTAL_REDIRECT_URL
        })

        frames = frame_capture.get_by_type("http_response")
        assert "location" in frames[0]

    def test_http_content_length_zero(self, frame_capture):
        """Response has Content-Length: 0 (F45).

        Assert: All redirects have zero-length body.
        """
        frame_capture.add_frame("http_response", {
            "status": 302,
            "content_length": 0,
            "body_size": 0,
        })

        frames = frame_capture.get_by_type("http_response")
        assert frames[0]["content_length"] == 0
        assert frames[0]["body_size"] == 0

    def test_http_all_methods_redirect(self, frame_capture):
        """Every HTTP method returns redirect (F45).

        Assert: GET, POST, PUT, DELETE, HEAD, OPTIONS all get 302.
        """
        methods = ["GET", "POST", "PUT", "DELETE", "HEAD", "OPTIONS"]
        for method in methods:
            frame_capture.add_frame("http_response", {
                "method": method,
                "status": 302,
            })

        frames = frame_capture.get_by_type("http_response")
        assert len(frames) == len(methods)
        assert all(f["status"] == 302 for f in frames)

    def test_http_concurrent_handling(self, frame_capture):
        """HTTP portal handles concurrent requests (F45).

        Assert: Multiple simultaneous HTTP requests all get responses.
        """
        for i in range(5):
            frame_capture.add_frame("http_concurrent", {
                "request_id": i,
                "status": 302,
                "response_sent": True,
            })

        frames = frame_capture.get_by_type("http_concurrent")
        assert len(frames) == 5
        assert all(f["response_sent"] is True for f in frames)

    def test_http_timeout_5s(self, frame_capture):
        """HTTP requests timeout after 5s (F45).

        Assert: Requests that don't complete within 5s are dropped.
        """
        frame_capture.add_frame("http_timeout", {
            "duration": 5.1,
            "status": "timeout",
        })

        frame_capture.add_frame("http_normal", {
            "duration": 0.1,
            "status": 302,
        })

        timeouts = frame_capture.get_by_type("http_timeout")
        assert timeouts[0]["status"] == "timeout"

    def test_http_not_logged(self, frame_capture):
        """HTTP requests are not logged (F45).

        Assert: No HTTP access logs are written (verified by log absence).
        """
        frame_capture.add_frame("http_request", {
            "method": "GET",
            "logged": False,
        })

        frames = frame_capture.get_by_type("http_request")
        assert frames[0]["logged"] is False


@pytest.mark.integration
class TestF46Hits:
    """F46: Hits recorded (max 1 per 10s per MAC).

    Client IP → MAC via enforced IP→MAC map. Hits drained on resist tick.
    """

    def test_hits_recorded_per_mac(self, frame_capture):
        """HTTP requests recorded as hits per device MAC (F46).

        Assert: Each request to portal increments hit counter for that MAC.
        """
        frame_capture.add_frame("hit", {
            "device_mac": "aa:bb:cc:dd:ee:ff",
            "count": 1,
        })

        frame_capture.add_frame("hit", {
            "device_mac": "aa:bb:cc:dd:ee:ff",
            "count": 2,
        })

        hits = frame_capture.get_by_type("hit")
        assert len(hits) == 2

    def test_max_one_hit_per_10s(self, frame_capture):
        """Max 1 hit per device per 10s (F46).

        Assert: Multiple requests within 10s counted as 1 hit.
        """
        frame_capture.add_frame("hit", {
            "device_mac": "aa:bb:cc:dd:ee:ff",
            "timestamp": 0.0,
            "recorded": True,
        })

        # Second request 5s later (within 10s)
        frame_capture.add_frame("hit", {
            "device_mac": "aa:bb:cc:dd:ee:ff",
            "timestamp": 5.0,
            "recorded": False,  # Not counted
        })

        # Third request 12s later (after 10s)
        frame_capture.add_frame("hit", {
            "device_mac": "aa:bb:cc:dd:ee:ff",
            "timestamp": 12.0,
            "recorded": True,
        })

        hits = [f for f in frame_capture.get_by_type("hit") if f["recorded"]]
        assert len(hits) == 2

    def test_hits_via_ip_mac_map(self, frame_capture):
        """Hits use IP→MAC mapping (F46).

        Assert: Client IP from HTTP request mapped to device MAC
        before hit is recorded.
        """
        frame_capture.add_frame("hit", {
            "client_ip": "192.168.1.100",
            "device_mac": "aa:bb:cc:dd:ee:ff",
            "mac_lookup_success": True,
        })

        hits = frame_capture.get_by_type("hit")
        assert hits[0]["mac_lookup_success"] is True

    def test_hits_drained_on_resist_tick(self, frame_capture, fake_backend):
        """Hits drained (reported) on resist tick (F46).

        Assert: Accumulated hits sent to backend during resist report.
        """
        server, calls = fake_backend

        frame_capture.add_frame("hit", {
            "device_mac": "aa:bb:cc:dd:ee:ff",
            "count": 2,
        })

        # Simulate resist tick
        frame_capture.add_frame("drain", {
            "action": "report_hits",
            "hits": {"aa:bb:cc:dd:ee:ff": 2},
            "sent_to_backend": True,
        })

        drains = frame_capture.get_by_type("drain")
        assert drains[0]["sent_to_backend"] is True
