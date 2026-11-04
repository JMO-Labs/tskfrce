"""Homework wiring tests."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from blocker.homework import HomeworkGate
from blocker.hw_wiring import HomeworkWiring


def test_wiring_on_state_kills_conntrack_for_ended_mac():
    """on_state calls kill_conntrack for MACs that ended."""
    gate = HomeworkGate()
    gate.update({"aa:bb:cc:dd:ee:01": {"allow": ["google.com"], "block": [], "until": "2099-01-01T00:00:00Z"}})

    fw_mock = MagicMock()
    mac_for_ip = MagicMock()
    ip_for_mac = MagicMock(return_value="192.168.1.10")
    cfg = MagicMock()

    wiring = HomeworkWiring(gate, fw_mock, mac_for_ip, ip_for_mac, cfg)

    # Update to remove the MAC
    wiring.on_state({})

    # Should call kill_conntrack for the ended MAC
    fw_mock.kill_conntrack.assert_called()
    call_args = fw_mock.kill_conntrack.call_args[1]
    assert call_args["device_ip"] == "192.168.1.10"


def test_wiring_pairs_for_render():
    """pairs_for_render returns hw_out and hw_back sets."""
    gate = HomeworkGate()
    gate.update({"aa:bb:cc:dd:ee:01": {"allow": ["google.com"], "block": [], "until": "2099-01-01T00:00:00Z"}})
    gate.decide("aa:bb:cc:dd:ee:01", "classroom.google.com")
    gate.record("aa:bb:cc:dd:ee:01", "classroom.google.com", ["8.8.8.8"], ttl=300, via="list", pulled_by=None)

    ip_for_mac = MagicMock(return_value="192.168.1.10")
    cfg = MagicMock()
    wiring = HomeworkWiring(gate, MagicMock(), MagicMock(), ip_for_mac, cfg)

    hw_out, hw_back = wiring.pairs_for_render()

    assert ("aa:bb:cc:dd:ee:01", "8.8.8.8") in hw_out
    assert ("8.8.8.8", "192.168.1.10") in hw_back


def test_wiring_dns_handle_calls_upstream_handle():
    """dns_handle delegates to upstream.handle_homework."""
    gate = MagicMock()
    fw_mock = MagicMock()
    mac_for_ip = MagicMock(return_value="aa:bb:cc:dd:ee:01")
    cfg = MagicMock()
    cfg.upstream_dns = "8.8.8.8"

    wiring = HomeworkWiring(gate, fw_mock, mac_for_ip, MagicMock(), cfg)

    with patch("blocker.hw_wiring.handle_homework", return_value=b"reply") as mock_handle:
        result = wiring.dns_handle("192.168.1.10", b"query")
        assert result == b"reply"
        mock_handle.assert_called_once()
        args = mock_handle.call_args[0]
        assert args[3] == "8.8.8.8"


def test_wiring_flush_activity_reports():
    """flush_activity drains and reports activity."""
    gate = HomeworkGate()
    gate.update({"aa:bb:cc:dd:ee:01": {"allow": ["google.com"], "block": [], "until": "2099-01-01T00:00:00Z"}})
    gate.decide("aa:bb:cc:dd:ee:01", "classroom.google.com")
    gate.record("aa:bb:cc:dd:ee:01", "classroom.google.com", ["8.8.8.8"], ttl=300, via="list", pulled_by=None)

    cfg = MagicMock()
    wiring = HomeworkWiring(gate, MagicMock(), MagicMock(), MagicMock(), cfg)

    report = MagicMock()
    wiring.flush_activity(report)

    # Should have called report with activity
    report.assert_called_once()
    activity = report.call_args[0][0]
    assert len(activity) > 0
    assert "classroom.google.com" in str(activity)
