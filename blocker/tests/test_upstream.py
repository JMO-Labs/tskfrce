"""Upstream DNS forwarding tests."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from blocker.config import _read_resolv_conf
from blocker.upstream import forward, handle_homework


def _has_scapy():
    """Check if scapy is available."""
    try:
        import scapy  # noqa: F401
        return True
    except ImportError:
        return False


def test_forward_timeout_returns_none():
    """forward returns None on timeout."""
    result = forward(b"query", "192.0.2.1", timeout=0.001)
    assert result is None


def test_forward_invalid_server_returns_none():
    """forward returns None when server is empty."""
    result = forward(b"query", "", timeout=1)
    assert result is None


def test_read_resolv_conf_returns_first_non_loopback(tmp_path):
    """_read_resolv_conf extracts the first non-loopback nameserver."""
    conf_file = tmp_path / "resolv.conf"
    conf_file.write_text("nameserver 127.0.0.1\nnameserver 8.8.8.8\nnameserver 1.1.1.1\n")
    result = _read_resolv_conf(str(conf_file))
    assert result == "8.8.8.8"


def test_read_resolv_conf_returns_none_if_only_loopback(tmp_path):
    """_read_resolv_conf returns None if only loopback nameservers."""
    conf_file = tmp_path / "resolv.conf"
    conf_file.write_text("nameserver 127.0.0.1\n")
    result = _read_resolv_conf(str(conf_file))
    assert result is None


@pytest.mark.skipif(not _has_scapy(), reason="scapy not available")
def test_handle_homework_denies_non_homework_mac():
    """handle_homework returns None for non-homework MACs."""
    gate = MagicMock()
    gate.active.return_value = False
    result = handle_homework(gate, MagicMock(), MagicMock(), "8.8.8.8", "192.168.1.10", b"query")
    assert result is None


@pytest.mark.skipif(not _has_scapy(), reason="scapy not available")
def test_handle_homework_denies_unparsable_query():
    """handle_homework returns None for unparsable queries."""
    gate = MagicMock()
    gate.active.return_value = True
    result = handle_homework(gate, MagicMock(), MagicMock(), "8.8.8.8", "192.168.1.10", b"garbage")
    assert result is None


@pytest.mark.skipif(not _has_scapy(), reason="scapy not available")
def test_handle_homework_integration():
    """Integration test for handle_homework with scapy (if available)."""
    pytest.importorskip("scapy")
    from scapy.layers.dns import DNS, DNSQR, DNSRR

    gate = MagicMock()
    gate.active.return_value = True
    gate.decide.return_value = (True, "list", None)
    gate.record.return_value = {"8.8.8.8"}
    gate.remaining.return_value = {"8.8.8.8": 300}

    firewall_add = MagicMock()
    mac_for_ip = MagicMock(return_value="aa:bb:cc:dd:ee:01")

    # Create a valid reply
    q = DNS(id=1, qr=0, qd=[DNSQR(qname="allowed.com.", qtype=1)])
    query = bytes(q)
    reply_q = DNS(
        id=1,
        qr=1,
        qd=[DNSQR(qname="allowed.com.", qtype=1)],
        an=[DNSRR(rrname="allowed.com.", type="A", ttl=300, rdata="8.8.8.8")],
    )
    reply = bytes(reply_q)

    with patch("blocker.upstream.forward", return_value=reply):
        with patch("blocker.upstream.a_records", return_value=(["8.8.8.8"], 300)):
            result = handle_homework(
                gate, firewall_add, mac_for_ip, "8.8.8.8", "192.168.1.10", query
            )
            assert result == reply
            firewall_add.assert_called_once()
            call_args = firewall_add.call_args[0]
            assert ("aa:bb:cc:dd:ee:01", "8.8.8.8") in call_args[0]
            assert ("8.8.8.8", "192.168.1.10") in call_args[1]
            assert call_args[0][("aa:bb:cc:dd:ee:01", "8.8.8.8")] == 300
