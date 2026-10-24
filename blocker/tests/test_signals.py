"""Signals: DHCP fingerprint, mDNS parsing, change-only reporting."""

from __future__ import annotations

import time

from pathlib import Path
from unittest.mock import Mock

from scapy.all import BOOTP, DHCP, IP, UDP, Ether

from blocker.backend import Seen
from blocker.config import Config
from blocker.signals import Signals, dhcp_fp_from_packet, mdns_from_info

CFG = Config("http://b", "b", "t", "", Path("/tmp"))
MAC = "aa:bb:cc:dd:ee:01"


def _discover(prl):
    return (
        Ether(src=MAC, dst="ff:ff:ff:ff:ff:ff")
        / IP(src="0.0.0.0", dst="255.255.255.255")
        / UDP(sport=68, dport=67)
        / BOOTP(chaddr=bytes.fromhex(MAC.replace(":", "")))
        / DHCP(options=[("message-type", "discover"), ("param_req_list", prl), "end"])
    )


def test_dhcp_fp():
    assert dhcp_fp_from_packet(_discover([1, 121, 3, 6])) == (MAC, "1,121,3,6")


def test_dhcp_malformed():
    assert dhcp_fp_from_packet(object()) is None
    assert dhcp_fp_from_packet(Ether() / IP()) is None


def test_mdns_parse():
    got = mdns_from_info(
        "Bobbys-iPad.local.", {b"model": b"iPad13,1", b"x": None}, [bytes([10, 0, 0, 5])]
    )
    assert got == ("Bobbys-iPad", "iPad13,1", ["10.0.0.5"])


def test_mdns_no_model():
    assert mdns_from_info("h.local.", {}, []) == ("h", None, [])
    assert mdns_from_info(None, None, None) == (None, None, [])


def test_seen_body_optional_fields():
    s = Seen(mac=MAC, ip=None, ipv6=[], hostname=None, vendor=None)
    assert "model" not in s.body()
    s2 = Seen(mac=MAC, ip=None, ipv6=[], hostname=None, vendor=None, model="x" * 300)
    assert s2.body()["model"] == "x" * 255
    assert "mdns_name" not in s2.body()


def test_cache_reports_only_on_change():
    rep = Mock()
    sg = Signals(CFG, rep)
    sg.note_seen(Seen(mac=MAC, ip="10.0.0.5", ipv6=[], hostname="h", vendor="v"))
    assert sg.mac_for_ip("10.0.0.5") == MAC
    assert sg.update(MAC, dhcp_fp="1,3")
    assert not sg.update(MAC, dhcp_fp="1,3")
    assert sg.update(MAC, mdns_name="n")
    assert sg.update(MAC, dhcp_fp="1,3,6")
    assert rep.call_count == 3
    last = rep.call_args[0][1]
    assert (last.ip, last.hostname, last.mdns_name, last.dhcp_fp) == ("10.0.0.5", "h", "n", "1,3,6")


def test_dhcp_rejects_spoofed_sender_and_server_replies():
    spoofed = _discover([1, 3])
    spoofed[Ether].src = "aa:bb:cc:dd:ee:99"
    assert dhcp_fp_from_packet(spoofed) is None
    reply = _discover([1, 3])
    reply[BOOTP].op = 2
    assert dhcp_fp_from_packet(reply) is None


def test_unknown_mac_not_reported():
    rep = Mock()
    assert not Signals(CFG, rep).update(MAC, dhcp_fp="1,3")
    rep.assert_not_called()


def test_ambiguous_or_stale_ip_maps_to_nothing(monkeypatch):
    sg = Signals(CFG, Mock())
    sg.note_seen(Seen(mac=MAC, ip="10.0.0.5", ipv6=[], hostname=None, vendor=None))
    sg.note_seen(Seen(mac="aa:bb:cc:dd:ee:02", ip="10.0.0.5", ipv6=[], hostname=None, vendor=None))
    assert sg.mac_for_ip("10.0.0.5") is None
    sg2 = Signals(CFG, Mock())
    sg2.note_seen(Seen(mac=MAC, ip="10.0.0.6", ipv6=[], hostname=None, vendor=None))
    later = time.monotonic() + 601
    monkeypatch.setattr("blocker.signals.time.monotonic", lambda: later)
    assert sg2.mac_for_ip("10.0.0.6") is None
