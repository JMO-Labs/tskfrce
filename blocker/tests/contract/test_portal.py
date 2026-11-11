"""Contract tests for captive portal (F44–F45).

Black-box tests that verify portal DNS and HTTP behavior:
- F44: DNS portal - UDP only, A-only, TTL 30, correct response format
- F45: HTTP portal - 302 redirect, Content-Length 0
"""

import pytest


@pytest.mark.integration
class TestF44DNSPortal:
    """F44: DNS on UDP :53, A-only, TTL 30, aa=1, ra=1, rd copied.

    No TCP DNS listener even though tcp/53 is DNAT'ed.
    """

    @pytest.mark.skip(reason="Requires Docker container and DNS query simulation")
    def test_dns_listens_on_udp_53(self, blocker_container):
        """DNS portal listens on UDP port 53."""
        pass

    @pytest.mark.skip(reason="Requires Docker container and DNS query simulation")
    def test_dns_max_512_bytes(self, blocker_container):
        """DNS drops packets > 512 bytes."""
        pass

    @pytest.mark.skip(reason="Requires Docker container and DNS query simulation")
    def test_dns_rejects_response_frames(self, blocker_container):
        """Drops frames with response bit set."""
        pass

    @pytest.mark.skip(reason="Requires Docker container and DNS query simulation")
    def test_dns_rejects_nonzero_opcode(self, blocker_container):
        """Drops frames with opcode != 0."""
        pass

    @pytest.mark.skip(reason="Requires Docker container and DNS query simulation")
    def test_dns_requires_one_question(self, blocker_container):
        """Drops frames with qdcount != 1."""
        pass

    @pytest.mark.skip(reason="Requires Docker container and DNS query simulation")
    def test_dns_a_record_response(self, blocker_container):
        """A queries return box IP, TTL 30, aa=1, ra=1."""
        pass

    @pytest.mark.skip(reason="Requires Docker container and DNS query simulation")
    def test_dns_copies_rd_flag(self, blocker_container):
        """RD flag copied from query to response."""
        pass

    @pytest.mark.skip(reason="Requires Docker container and DNS query simulation")
    def test_dns_other_types_noerror(self, blocker_container):
        """Non-A types return NOERROR, no answer."""
        pass

    @pytest.mark.skip(reason="Requires Docker container and DNS query simulation")
    def test_no_tcp_dns_listener(self, blocker_container):
        """TCP port 53 not listening (DNAT'ed to nothing)."""
        pass


@pytest.mark.integration
class TestF45HTTPPortal:
    """F45: HTTP on :80, 302 redirect, Content-Length: 0, no logging."""

    @pytest.mark.skip(reason="Requires Docker container and HTTP request simulation")
    def test_http_listens_on_80(self, blocker_container):
        """HTTP portal listens on port 80."""
        pass

    @pytest.mark.skip(reason="Requires Docker container and HTTP request simulation")
    def test_http_redirect_status(self, blocker_container):
        """All requests return 302 redirect."""
        pass

    @pytest.mark.skip(reason="Requires Docker container and HTTP request simulation")
    def test_http_redirect_location(self, blocker_container):
        """Redirect Location is PORTAL_REDIRECT_URL."""
        pass

    @pytest.mark.skip(reason="Requires Docker container and HTTP request simulation")
    def test_http_content_length_zero(self, blocker_container):
        """Response has Content-Length: 0."""
        pass

    @pytest.mark.skip(reason="Requires Docker container and HTTP request simulation")
    def test_http_all_methods_redirect(self, blocker_container):
        """Every HTTP method (GET, POST, etc.) returns redirect."""
        pass

    @pytest.mark.skip(reason="Requires Docker container and HTTP request simulation")
    def test_http_concurrent(self, blocker_container):
        """HTTP portal handles concurrent requests."""
        pass

    @pytest.mark.skip(reason="Requires Docker container and HTTP request simulation")
    def test_http_timeout_5s(self, blocker_container):
        """HTTP requests timeout after 5s."""
        pass

    @pytest.mark.skip(reason="Requires Docker container and access log inspection")
    def test_http_not_logged(self, blocker_container):
        """HTTP requests are not logged."""
        pass
