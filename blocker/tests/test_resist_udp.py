"""UDP/QUIC flows of pre-pause must not count as bypass (tskfrce#91)."""

from types import SimpleNamespace

import pytest
from blocker.arp import LanFacts, TargetAddrs
from blocker.resist import ResistanceCounter, ResistanceWatch, UdpInfo

LAN = LanFacts(gateway_ip="10.0.0.1", gateway_mac="aa:aa:aa:aa:aa:01", box_mac="bb:bb:bb:bb:bb:02")
KID = "cc:cc:cc:cc:cc:03"
KID_IP = "10.0.0.5"
SRV = "203.0.113.9"
WATCHED = {KID: TargetAddrs(mac=KID, ip=KID_IP, ip6=())}
GW, BOX = LAN.gateway_mac, LAN.box_mac


def _counter(**kw):
    t = [100.0]
    kw.setdefault("threshold", 3)
    c = ResistanceCounter(LAN, window=30, clock=lambda: t[0], **kw)
    c.set_watched(WATCHED)
    return c, t


def _udp(c, t, dport, at):
    t[0] = at
    c.observe(GW, BOX, KID_IP, SRV, udp=UdpInfo(sport=443, dport=dport))


def test_quic_packets_of_prepause_flow_are_not_bypass():
    c, t = _counter(grace=30, threshold=20)
    for i in range(100):
        _udp(c, t, 50000, at=100 + i * 0.5)  # first seen in grace, runs 20 s past it
    assert c.resisting() == set()
    assert c.tally(KID).from_gateway == 0


def test_new_udp_flows_after_grace_are_bypass():
    c, t = _counter(grace=30, threshold=20)
    for i in range(25):
        _udp(c, t, 51000 + i, at=131 + i * 0.5)
    assert c.resisting() == {KID}


def test_each_new_post_grace_udp_flow_counts_once():
    c, t = _counter(grace=30)
    for i in range(10):
        _udp(c, t, 51000, at=131 + i)
    assert c.tally(KID).from_gateway == 1


def test_watch_builds_udp_info_from_scapy_frame():
    pytest.importorskip("scapy")
    from scapy.layers.inet import IP, UDP
    from scapy.layers.l2 import Ether

    t = [100.0]
    cap = {}
    c = ResistanceCounter(LAN, threshold=3, window=30, grace=30, clock=lambda: t[0])
    w = ResistanceWatch(
        SimpleNamespace(lan_iface=""),
        c,
        sniffer_factory=lambda **kw: cap.update(kw) or SimpleNamespace(stop=lambda: None),
    )
    w.set_watched(WATCHED)
    t[0] = 140.0
    for i in range(3):
        f = Ether(src=GW, dst=BOX) / IP(src=SRV, dst=KID_IP) / UDP(sport=443, dport=50000 + i)
        cap["prn"](Ether(bytes(f)))
    assert c.resisting() == {KID}
