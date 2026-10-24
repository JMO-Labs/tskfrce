"""VLAN detection: pure packet parsing, tally, reporting."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import Mock

from scapy.all import ARP, Dot1Q, Ether, Raw

from blocker.config import Config
from blocker.vlan import VlanDetector, VlanTally, vlan_of

CFG = Config("http://b", "b", "t", "eth0", Path("/tmp"))
SRC = "aa:bb:cc:00:00:01"


def _arp(vid, mac=SRC, ip="192.168.20.5"):
    return Ether(src=mac, dst="ff:ff:ff:ff:ff:ff") / Dot1Q(vlan=vid) / ARP(psrc=ip, hwsrc=mac)


def test_vlan_of_tagged_arp():
    assert vlan_of(_arp(20)) == (20, SRC, "192.168.20.5")


def test_vlan_of_tagged_non_arp_has_no_ip():
    pkt = Ether(src=SRC.upper()) / Dot1Q(vlan=30) / Raw(b"x")
    assert vlan_of(pkt) == (30, SRC, None)


def test_vlan_of_ignores_probe_ip_and_untagged_and_bad_vid():
    assert vlan_of(_arp(20, ip="0.0.0.0"))[2] is None
    assert vlan_of(Ether(src=SRC) / ARP(psrc="10.0.0.1")) is None
    assert vlan_of(_arp(0)) is None
    assert vlan_of(_arp(4095)) is None


def test_vlan_of_garbage():
    assert vlan_of(None) is None
    assert vlan_of(object()) is None
    assert vlan_of(Raw(b"junk")) is None


def test_tally_counts_distinct_macs_and_guesses_subnet():
    t = VlanTally()
    t.observe(20, "a", "192.168.20.5")
    t.observe(20, "a", "192.168.20.5")
    t.observe(20, "b", "192.168.20.9")
    t.observe(20, "c", "10.9.9.9")
    t.observe(30, "d", None)
    snap = {v["vid"]: v for v in t.snapshot()}
    assert snap[20] == {"vid": 20, "macs": 3, "subnet": "192.168.20.0/24"}
    assert snap[30] == {"vid": 30, "macs": 1, "subnet": None}


def test_tally_ignores_link_local_for_subnet():
    t = VlanTally()
    t.observe(5, "a", "169.254.1.1")
    assert t.snapshot()[0]["subnet"] is None


def test_vlan_of_spoofed_arp_and_public_ip_give_no_ip():
    spoof = Ether(src=SRC) / Dot1Q(vlan=20) / ARP(psrc="192.168.20.5", hwsrc="aa:bb:cc:99:99:99")
    assert vlan_of(spoof) == (20, SRC, None)
    assert vlan_of(_arp(20, ip="8.8.8.8")) == (20, SRC, None)


def test_detector_packet_only_feeds_tally_and_report_body():
    rep = Mock()
    d = VlanDetector(CFG, report_vlans=rep)
    d.on_packet(_arp(20))
    d.on_packet(_arp(20))
    d.report_once()
    rep.assert_called_once_with(CFG, [{"vid": 20, "macs": 1, "subnet": "192.168.20.0/24"}])


def test_detector_skips_report_when_no_vlans():
    rep = Mock()
    VlanDetector(CFG, report_vlans=rep).report_once()
    rep.assert_not_called()


def test_detector_sniffs_lan_and_mirror_receive_only():
    calls = []
    d = VlanDetector(
        Config("http://b", "b", "t", "eth0", Path("/tmp"), mirror_iface="eth1"),
        sniffer_factory=lambda **k: calls.append(k) or Mock(),
    )
    d.start()
    assert [c["iface"] for c in calls] == ["eth0", "eth1"]
    d.stop()
