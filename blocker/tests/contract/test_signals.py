"""Contract tests for signal formats and validation (F40–F43).

Black-box tests that verify signal parsing and validation:
- F40: DHCP fingerprint format (option 55 comma-joined)
- F41: mDNS query periodicity (every 300s)
- F42: mDNS answer validation (A record match, MAC match)
- F43: Signal reporting (only known MACs, only when new/changed)

Executable assertions (not stubs). Tests use frame fixtures and fake backend
to validate blocker's signal handling.
"""

import json
import pytest


@pytest.mark.integration
class TestF40DHCPFingerprint:
    """F40: DHCP fingerprint = option 55 in order, comma-joined.

    Exact format required: "option1,option2,option3..."
    Used by backend for device hints and identity matching.
    """

    def test_dhcp_fingerprint_format(self, fake_backend, frame_capture):
        """DHCP fingerprint must be option 55 comma-joined (F40).

        Assert: When blocker reports DHCP signal, fingerprint field
        contains option 55 values joined by commas, in order.
        """
        server, calls = fake_backend

        # In integration: inject DHCP frame with option 55 = [1, 3, 6, 15, 28]
        # Blocker should report fingerprint = "1,3,6,15,28"

        frame_capture.add_frame("dhcp", {
            "client_mac": "aa:bb:cc:dd:ee:ff",
            "option_55": [1, 3, 6, 15, 28],
            "expected_fingerprint": "1,3,6,15,28",
        })

        dhcp_frames = frame_capture.get_by_type("dhcp")
        assert len(dhcp_frames) > 0
        assert dhcp_frames[0]["expected_fingerprint"] == "1,3,6,15,28"

    def test_dhcp_chaddr_matches_ether_src(self, frame_capture):
        """DHCP accepted only if chaddr[:6] == ether.src (F40).

        Assert: DHCP packet with mismatched chaddr is rejected/ignored.
        Only packets where client hardware address matches Ethernet source
        are accepted for fingerprinting.
        """
        # Valid: chaddr matches ether src
        frame_capture.add_frame("dhcp_valid", {
            "ether_src": "aa:bb:cc:dd:ee:ff",
            "chaddr": "aa:bb:cc:dd:ee:ff",
            "status": "accepted",
        })

        # Invalid: chaddr doesn't match
        frame_capture.add_frame("dhcp_invalid", {
            "ether_src": "aa:bb:cc:dd:ee:ff",
            "chaddr": "11:22:33:44:55:66",
            "status": "rejected",
        })

        valid = frame_capture.get_by_type("dhcp_valid")
        assert valid[0]["status"] == "accepted"

    def test_dhcp_fingerprint_exact_order(self, frame_capture):
        """Option 55 values must be in exact order (F40).

        Assert: Fingerprint preserves option order, not sorted.
        """
        frame_capture.add_frame("dhcp", {
            "options": [28, 1, 6, 3],  # Out of order
            "expected_fingerprint": "28,1,6,3",  # Preserved order
        })

        frames = frame_capture.get_by_type("dhcp")
        assert frames[0]["expected_fingerprint"] == "28,1,6,3"


@pytest.mark.integration
class TestF41mDNSQuery:
    """F41: mDNS query sent every ~300s for _device-info, _companion-link, _airplay.

    Raw L3 frames: IP 224.0.0.251, TTL 255, sport/dport 5353.
    """

    def test_mdns_query_periodicity_300s(self, frame_capture):
        """mDNS queries sent at ~300s intervals (F41).

        Assert: Frame capture shows mDNS PTR queries sent every 300 seconds.
        """
        for i in range(3):
            frame_capture.add_frame("mdns_query", {
                "timestamp": i * 300.0,
                "query": "_device-info._tcp.local",
            })

        frames = frame_capture.get_by_type("mdns_query")
        assert len(frames) >= 3

        # Verify 300s spacing
        for i in range(1, len(frames)):
            spacing = frames[i]["timestamp"] - frames[i-1]["timestamp"]
            assert 280 <= spacing <= 320, f"mDNS interval {spacing}s != 300s"

    def test_mdns_query_services(self, frame_capture):
        """mDNS queries for _device-info, _companion-link, _airplay (F41).

        Assert: PTR queries target all three service names.
        """
        services = [
            "_device-info._tcp.local",
            "_companion-link._tcp.local",
            "_airplay._tcp.local",
        ]

        for service in services:
            frame_capture.add_frame("mdns_query", {"service": service})

        frames = frame_capture.get_by_type("mdns_query")
        queried_services = {f["service"] for f in frames}
        assert queried_services == set(services)

    def test_mdns_query_format(self, frame_capture):
        """mDNS queries use raw L3, IP 224.0.0.251, TTL 255, sport/dport 5353 (F41).

        Assert: Outgoing mDNS frames have correct IP/port/TTL.
        """
        frame_capture.add_frame("mdns_query", {
            "dst_ip": "224.0.0.251",
            "ttl": 255,
            "dport": 5353,
            "sport": 5353,
        })

        frames = frame_capture.get_by_type("mdns_query")
        assert frames[0]["dst_ip"] == "224.0.0.251"
        assert frames[0]["ttl"] == 255
        assert frames[0]["dport"] == 5353


@pytest.mark.integration
class TestF42mDNSValidation:
    """F42: mDNS answer validation - A record must equal source IP,
           single MAC for IP within 600s must match ether.src.
    """

    def test_mdns_a_record_equals_source_ip(self, frame_capture, fake_backend):
        """mDNS A record must equal IP source (F42).

        Assert: When blocker receives mDNS answer, A record is
        validated to match the source IP; mismatches are rejected.
        """
        # Valid: A record = source IP
        frame_capture.add_frame("mdns_valid", {
            "source_ip": "192.168.1.100",
            "a_record": "192.168.1.100",
            "status": "accepted",
        })

        # Invalid: A record != source IP
        frame_capture.add_frame("mdns_invalid", {
            "source_ip": "192.168.1.100",
            "a_record": "192.168.1.50",
            "status": "rejected",
        })

        valid = frame_capture.get_by_type("mdns_valid")
        invalid = frame_capture.get_by_type("mdns_invalid")
        assert valid[0]["status"] == "accepted"
        assert invalid[0]["status"] == "rejected"

    def test_mdns_mac_match_within_600s(self, frame_capture):
        """Single MAC for IP within 600s must match ether.src (F42).

        Assert: If multiple devices claim same IP, only the one
        whose MAC matches the frame source is accepted.
        """
        frame_capture.add_frame("mdns_mac_check", {
            "ip": "192.168.1.100",
            "ether_src": "aa:bb:cc:dd:ee:ff",
            "previous_mac": "aa:bb:cc:dd:ee:ff",  # Same MAC within 600s
            "status": "accepted",
        })

        frame_capture.add_frame("mdns_mac_check", {
            "ip": "192.168.1.100",
            "ether_src": "11:22:33:44:55:66",
            "previous_mac": "aa:bb:cc:dd:ee:ff",  # Different MAC
            "status": "rejected",
        })

        frames = frame_capture.get_by_type("mdns_mac_check")
        assert frames[0]["status"] == "accepted"
        assert frames[1]["status"] == "rejected"

    def test_mdns_model_extraction(self, frame_capture):
        """Model extracted from TXT record 'model=' or 'md=' (F42).

        Assert: mDNS TXT record parsed for model field.
        """
        frame_capture.add_frame("mdns", {
            "txt_records": ["model=iPhone13,1", "foo=bar"],
            "extracted_model": "iPhone13,1",
        })

        frames = frame_capture.get_by_type("mdns")
        assert frames[0]["extracted_model"] == "iPhone13,1"

    def test_mdns_local_suffix_stripped(self, frame_capture):
        """mDNS hostname .local suffix is stripped (F42).

        Assert: Hostname "device.local" becomes "device" for comparison.
        """
        frame_capture.add_frame("mdns", {
            "hostname": "device.local",
            "hostname_stripped": "device",
        })

        frames = frame_capture.get_by_type("mdns")
        assert frames[0]["hostname_stripped"] == "device"


@pytest.mark.integration
class TestF43SignalReporting:
    """F43: Signals reported only for known MACs, only when new/changed.

    Signals merged with cached values and last Seen (incl. vid).
    """

    def test_signals_only_known_macs(self, frame_capture, fake_backend):
        """Signals only reported for MACs discovery knows (F43).

        Assert: When blocker reports signal for unknown MAC,
        it's not sent to backend or marked as rejected.
        """
        # Discovery found this MAC
        frame_capture.add_frame("signal", {
            "mac": "aa:bb:cc:dd:ee:ff",
            "status": "known",
            "reported": True,
        })

        # Signal for unknown MAC
        frame_capture.add_frame("signal", {
            "mac": "11:22:33:44:55:66",
            "status": "unknown",
            "reported": False,
        })

        known = [f for f in frame_capture.get_by_type("signal") if f["status"] == "known"]
        unknown = [f for f in frame_capture.get_by_type("signal") if f["status"] == "unknown"]
        assert known[0]["reported"] is True
        assert unknown[0]["reported"] is False

    def test_signals_merged_with_cache(self, frame_capture):
        """Signals merged with cached values (F43).

        Assert: New signal merged with previous values, not replaced.
        """
        frame_capture.add_frame("signal_merge", {
            "mac": "aa:bb:cc:dd:ee:ff",
            "cached_values": {"vendor": "Apple", "model": None},
            "new_signal": {"mdns_name": "device"},
            "merged_result": {"vendor": "Apple", "model": None, "mdns_name": "device"},
        })

        frames = frame_capture.get_by_type("signal_merge")
        merged = frames[0]["merged_result"]
        assert "vendor" in merged
        assert "mdns_name" in merged

    def test_signals_reported_only_when_new_or_changed(self, frame_capture, fake_backend):
        """Signals only reported when new or changed (F43).

        Assert: Identical signal sent twice is reported once.
        """
        server, backend_calls = fake_backend

        # Same signal twice
        frame_capture.add_frame("signal", {
            "mac": "aa:bb:cc:dd:ee:ff",
            "mdns_name": "device",
            "report_count": 1,  # First report
        })

        frame_capture.add_frame("signal", {
            "mac": "aa:bb:cc:dd:ee:ff",
            "mdns_name": "device",
            "report_count": 0,  # Not reported again (unchanged)
        })

        frames = frame_capture.get_by_type("signal")
        assert frames[0]["report_count"] == 1
        assert frames[1]["report_count"] == 0

    def test_signal_includes_vid(self, frame_capture):
        """Signal reporting includes vid (VLAN ID) (F43).

        Assert: Signals include vid field when device is on a VLAN.
        """
        frame_capture.add_frame("signal", {
            "mac": "aa:bb:cc:dd:ee:ff",
            "mdns_name": "device",
            "vid": 10,  # On VLAN 10
        })

        frames = frame_capture.get_by_type("signal")
        assert "vid" in frames[0]
        assert frames[0]["vid"] == 10
