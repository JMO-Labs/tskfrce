from types import SimpleNamespace

import pytest
from blocker.arp import LanFacts, TargetAddrs
from blocker.resist import ResistanceCounter, ResistanceWatch, TcpInfo, _norm

LAN = LanFacts(gateway_ip="10.0.0.1", gateway_mac="aa:aa:aa:aa:aa:01", box_mac="bb:bb:bb:bb:bb:02")
KID = "cc:cc:cc:cc:cc:03"
KID_IP = "10.0.0.5"
KID_IP6 = "fe80::5"
WATCHED = {KID: TargetAddrs(mac=KID, ip=KID_IP, ip6=(KID_IP6,))}
GW = LAN.gateway_mac
BOX = LAN.box_mac
INET = "203.0.113.9"  # internet source (outside any LAN cidr used here)
INET6 = "2001:db8::9"
LAN_CIDRS = ["10.0.0.0/8", "fe80::/10"]


def _counter(watched=WATCHED, **kw):
    t = [100.0]
    c = ResistanceCounter(LAN, threshold=3, window=30, clock=lambda: t[0], **kw)
    c.set_watched(watched)
    return c, t


def test_idle_device_is_not_resisting():
    c, _ = _counter()
    assert c.resisting() == set()


def test_gateway_return_traffic_reaches_threshold():
    c, _ = _counter()
    for _ in range(3):
        c.observe(GW, BOX, KID_IP, INET)
    assert c.resisting() == {KID}
    assert c.tally(KID).from_gateway == 3


def test_gateway_return_traffic_matches_v6_dst():
    c, _ = _counter()
    for _ in range(3):
        c.observe(GW, BOX, KID_IP6, INET6)
    assert c.resisting() == {KID}


def test_v6_noncanonical_dst_still_maps():
    c, _ = _counter()
    noncanonical = "fe80:0000:0000:0000:0000:0000:0000:0005"
    for _ in range(3):
        c.observe(GW, BOX, noncanonical, INET6)
    assert c.resisting() == {KID}


def test_lan_sourced_return_traffic_never_flags():
    # Another LAN host reaching the device (e.g. a printer) must not look like a bypass.
    c, _ = _counter(lan_cidrs=LAN_CIDRS)
    for _ in range(5):
        c.observe(GW, BOX, KID_IP, "10.0.0.7")
    assert c.resisting() == set()
    assert c.tally(KID).from_gateway == 0


def test_internet_sourced_return_traffic_flags_with_lan_cidrs():
    c, _ = _counter(lan_cidrs=LAN_CIDRS)
    for _ in range(3):
        c.observe(GW, BOX, KID_IP, INET)
    assert c.resisting() == {KID}


def test_missing_ip_src_does_not_flag():
    c, _ = _counter()
    for _ in range(5):
        c.observe(GW, BOX, KID_IP)  # no ip_src -> cannot be the internet-return signal
    assert c.resisting() == set()


def test_device_frames_to_box_do_not_flag():
    c, _ = _counter()
    for _ in range(5):
        c.observe(KID, BOX)
    assert c.resisting() == set()
    assert c.tally(KID).to_box == 5
    assert c.tally(KID).from_gateway == 0


def test_gateway_to_unwatched_ip_ignored():
    c, _ = _counter()
    c.observe(GW, BOX, "10.0.0.99", INET)
    assert c.resisting() == set()
    assert c.tally(KID).from_gateway == 0


def test_frames_not_to_box_ignored():
    c, _ = _counter()
    # gateway talking to the kid directly (not the box) is not our signal
    c.observe(GW, "ee:ee:ee:ee:ee:ee", KID_IP, INET)
    assert c.tally(KID).from_gateway == 0


def test_window_resets_counts():
    c, t = _counter()
    c.observe(GW, BOX, KID_IP, INET)
    c.observe(GW, BOX, KID_IP, INET)
    t[0] += 31
    c.observe(GW, BOX, KID_IP, INET)
    assert c.tally(KID).from_gateway == 1


def test_unwatch_drops_tally():
    c, _ = _counter()
    c.observe(GW, BOX, KID_IP, INET)
    c.set_watched({})
    assert c.tally(KID).from_gateway == 0


def test_unknown_gateway_mac_never_flags():
    lan = LanFacts(gateway_ip="10.0.0.1", gateway_mac=None, box_mac=LAN.box_mac)
    c = ResistanceCounter(lan, threshold=1)
    c.set_watched(WATCHED)
    c.observe("aa:aa:aa:aa:aa:01", lan.box_mac, KID_IP, INET)
    assert c.resisting() == set()


def test_mac_and_ip_case_insensitive():
    c, _ = _counter()
    for _ in range(3):
        c.observe(GW.upper(), BOX.upper(), KID_IP.upper(), INET)
    assert c.resisting() == {KID}


def test_watch_restarts_sniffer_with_box_and_src_filter():
    calls = []

    class FakeSniffer:
        def __init__(self, **kw):
            calls.append(kw)

        def stop(self):
            pass

    counter = ResistanceCounter(LAN)
    w = ResistanceWatch(
        SimpleNamespace(lan_iface="eth0"), counter, sniffer_factory=lambda **kw: FakeSniffer(**kw)
    )
    w.set_watched(WATCHED)
    assert calls[-1]["iface"] == "eth0"
    assert calls[-1]["filter"].startswith(
        f"(ether dst {BOX} and (ether src {GW.lower()} or ether src {KID}))"
    )
    w.set_watched({})
    assert w._sniffer is None


def test_watch_prn_feeds_counter():
    pytest.importorskip("scapy")
    from scapy.layers.inet import IP
    from scapy.layers.l2 import Ether

    captured = {}
    counter = ResistanceCounter(LAN, threshold=1)
    w = ResistanceWatch(
        SimpleNamespace(lan_iface=""),
        counter,
        sniffer_factory=lambda **kw: captured.update(kw) or SimpleNamespace(stop=lambda: None),
    )
    w.set_watched(WATCHED)
    captured["prn"](Ether(src=GW, dst=BOX) / IP(src=INET, dst=KID_IP))
    assert counter.resisting() == {KID}


def _watch(factory):
    return ResistanceWatch(
        SimpleNamespace(lan_iface=""), ResistanceCounter(LAN), sniffer_factory=factory
    )


def test_watch_survives_factory_error():
    def boom(**kw):
        raise OSError("no iface")

    w = _watch(boom)
    w.set_watched(WATCHED)
    assert w._sniffer is None


def test_watch_same_set_does_not_restart():
    calls = []
    w = _watch(lambda **kw: calls.append(kw) or SimpleNamespace(stop=lambda: None))
    w.set_watched(WATCHED)
    w.set_watched(dict(WATCHED))
    assert len(calls) == 1


def test_watch_no_start_after_stop():
    calls = []
    w = _watch(lambda **kw: calls.append(kw) or SimpleNamespace(stop=lambda: None))
    w.stop()
    w.set_watched(WATCHED)
    assert calls == []


def test_watch_retries_after_failed_start():
    calls = []

    def flaky(**kw):
        calls.append(kw)
        if len(calls) == 1:
            raise OSError("iface down")
        return SimpleNamespace(stop=lambda: None)

    w = _watch(flaky)
    w.set_watched(WATCHED)
    w.set_watched(WATCHED)
    assert len(calls) == 2
    assert w._sniffer is not None


def test_reset_drops_tally():
    c, _ = _counter()
    for _ in range(3):
        c.observe(GW, BOX, KID_IP, INET)
    c.reset(KID.upper())
    assert c.tally(KID).from_gateway == 0
    assert c.resisting() == set()


def _watch_cb(cb):
    captured = {}
    w = ResistanceWatch(
        SimpleNamespace(lan_iface=""),
        ResistanceCounter(LAN),
        sniffer_factory=lambda **kw: captured.update(kw) or SimpleNamespace(stop=lambda: None),
        on_new_ip=cb,
    )
    w.set_watched(WATCHED)
    return w, captured


def test_filter_also_captures_arp_and_dhcp():
    _, cap = _watch_cb(lambda *a: None)
    assert cap["filter"] == (
        f"(ether dst {BOX} and (ether src {GW.lower()} or ether src {KID}))"
        " or arp or (udp and (port 67 or port 68))"
    )


def test_arp_from_blocked_mac_with_new_ip_fires_callback():
    pytest.importorskip("scapy")
    from scapy.layers.l2 import ARP, Ether

    got = []
    _, cap = _watch_cb(lambda m, ip: got.append((m, ip)))
    cap["prn"](Ether(src=KID, dst="ff:ff:ff:ff:ff:ff") / ARP(op=1, hwsrc=KID, psrc="10.0.0.77"))
    cap["prn"](Ether(src=KID, dst=BOX) / ARP(op=2, hwsrc=KID, psrc="10.0.0.78", hwdst=BOX))
    assert got == [(KID, "10.0.0.77"), (KID, "10.0.0.78")]


def test_arp_known_ip_probe_or_other_mac_ignored():
    pytest.importorskip("scapy")
    from scapy.layers.l2 import ARP, Ether

    got = []
    _, cap = _watch_cb(lambda m, ip: got.append((m, ip)))
    cap["prn"](Ether(src=KID, dst=BOX) / ARP(op=1, hwsrc=KID, psrc=KID_IP))  # same IP
    cap["prn"](Ether(src=KID, dst=BOX) / ARP(op=1, hwsrc=KID, psrc="0.0.0.0"))  # probe
    cap["prn"](Ether(src="dd:dd:dd:dd:dd:04", dst=BOX) / ARP(op=1, psrc="10.0.0.9"))  # unwatched
    assert got == []


def _dhcp(msg, *, src, chaddr, **bootp):
    from scapy.layers.dhcp import BOOTP, DHCP
    from scapy.layers.inet import IP, UDP
    from scapy.layers.l2 import Ether

    opts = [("message-type", msg)] + bootp.pop("opts", []) + ["end"]
    return (
        Ether(src=src, dst="ff:ff:ff:ff:ff:ff")
        / IP(src="0.0.0.0", dst="255.255.255.255")
        / UDP(sport=68, dport=67)
        / BOOTP(chaddr=bytes.fromhex(chaddr.replace(":", "")), **bootp)
        / DHCP(options=opts)
    )


def test_dhcp_request_and_ack_fire_callback():
    pytest.importorskip("scapy")
    got = []
    _, cap = _watch_cb(lambda m, ip: got.append((m, ip)))
    cap["prn"](_dhcp("request", src=KID, chaddr=KID, opts=[("requested_addr", "10.0.0.60")]))
    cap["prn"](_dhcp("ack", src=GW, chaddr=KID, yiaddr="10.0.0.61"))
    cap["prn"](_dhcp("discover", src=KID, chaddr=KID))  # no address: ignored
    assert got == [(KID, "10.0.0.60"), (KID, "10.0.0.61")]


def test_callback_error_does_not_break_sniffer():
    pytest.importorskip("scapy")
    from scapy.layers.l2 import ARP, Ether

    def boom(*a):
        raise RuntimeError

    _, cap = _watch_cb(boom)
    cap["prn"](Ether(src=KID, dst=BOX) / ARP(op=1, hwsrc=KID, psrc="10.0.0.77"))


def test_arp_for_already_claimed_alt_ip_ignored():
    pytest.importorskip("scapy")
    from scapy.layers.l2 import ARP, Ether

    got = []
    w, cap = _watch_cb(lambda m, ip: got.append((m, ip)))
    w.set_watched({KID: TargetAddrs(mac=KID, ip=KID_IP, alt_ip=("10.0.0.77",))})
    cap["prn"](Ether(src=KID, dst=BOX) / ARP(op=1, hwsrc=KID, psrc="10.0.0.77"))
    assert got == []


def test_address_only_change_keeps_sniffer_running():
    # the new-ip callback re-enters set_watched from the sniffer thread: never restart there
    calls = []
    w = ResistanceWatch(
        SimpleNamespace(lan_iface=""),
        ResistanceCounter(LAN),
        sniffer_factory=lambda **kw: calls.append(kw) or SimpleNamespace(stop=lambda: None),
    )
    w.set_watched(WATCHED)
    w.set_watched({KID: TargetAddrs(mac=KID, ip=KID_IP, alt_ip=("10.0.0.77",))})
    assert len(calls) == 1
    assert w.counter._ip2mac[_norm("10.0.0.77")] == KID


# --- TCP retransmits of pre-pause flows must not count as bypass (tskfrce#88) ---
SRV = "23.48.224.5"


def _tcp(c, t, seq, *, sport=443, dport=50000, syn_ack=False, at=None, ln=24):
    if at is not None:
        t[0] = at
    c.observe(
        GW,
        BOX,
        KID_IP,
        SRV,
        tcp=TcpInfo(sport=sport, dport=dport, seq=seq, length=ln, syn_ack=syn_ack),
    )


def test_retransmit_storm_of_prepause_flow_is_not_bypass():
    c, t = _counter(grace=30)
    for i in range(50):
        _tcp(c, t, 0, at=100 + i * 0.5 if i < 10 else 100 + 20 * i)  # same seq forever
    assert c.resisting() == set()


def test_frames_within_grace_are_ignored_even_if_new_seq():
    c, t = _counter(grace=30)
    for i in range(5):
        _tcp(c, t, i * 24, at=101 + i)
    assert c.tally(KID).from_gateway == 0


def test_new_flows_with_advancing_seq_after_grace_are_bypass():
    c, t = _counter(grace=30)
    _tcp(c, t, 0, at=130)  # opened after the grace: baseline only
    for i in range(3):
        _tcp(c, t, 24 + i * 24, at=140 + i)
    assert c.resisting() == {KID}


def test_prepause_flow_first_seen_in_grace_never_counts_even_if_seq_advances():
    c, t = _counter(grace=30)
    _tcp(c, t, 0, at=105)
    for i in range(30):
        _tcp(c, t, 24 + i * 24, at=140 + i)
    assert c.tally(KID).from_gateway == 0


def test_single_segment_on_unseen_flow_after_grace_not_counted():
    c, t = _counter(grace=30)
    _tcp(c, t, 5000, at=140)
    assert c.tally(KID).from_gateway == 0


def test_seq_wraparound_counts_as_advance():
    c, t = _counter(grace=30)
    _tcp(c, t, 0xFFFFFFF0, at=130)
    _tcp(c, t, 0, at=140)
    assert c.tally(KID).from_gateway == 1


def test_syn_acks_after_grace_are_bypass():
    c, t = _counter(grace=30)
    for i in range(3):
        _tcp(c, t, 0, sport=443, dport=50000 + i, syn_ack=True, ln=0, at=140 + i)
    assert c.resisting() == {KID}


def test_repeated_segment_after_grace_not_counted():
    c, t = _counter(grace=30)
    for i in range(10):
        _tcp(c, t, 0, at=140 + i)
    assert c.tally(KID).from_gateway == 0


# --- real frames through ResistanceWatch._on_packet (TCP extraction) ---
def _tcp_watch():
    pytest.importorskip("scapy")
    t = [100.0]
    captured = {}
    counter = ResistanceCounter(LAN, threshold=3, window=30, grace=30, clock=lambda: t[0])
    w = ResistanceWatch(
        SimpleNamespace(lan_iface=""),
        counter,
        sniffer_factory=lambda **kw: captured.update(kw) or SimpleNamespace(stop=lambda: None),
    )
    w.set_watched(WATCHED)
    t[0] = 140.0  # past the grace
    return counter, captured["prn"], t


def _frame(flags, dport=50000, seq=0, payload=b"", pad=b""):
    from scapy.layers.inet import IP, TCP
    from scapy.layers.l2 import Ether
    from scapy.packet import Raw

    f = (
        Ether(src=GW, dst=BOX)
        / IP(src=INET, dst=KID_IP)
        / TCP(sport=443, dport=dport, flags=flags, seq=seq)
    )
    if payload:
        f = f / Raw(payload)
    # Round-trip so Ether trailer padding dissects as scapy Padding.
    return Ether(bytes(f) + pad)


def test_watch_syn_acks_on_new_ports_are_resisting():
    counter, prn, _ = _tcp_watch()
    for i in range(3):
        prn(_frame("SA", dport=50000 + i))
    assert counter.resisting() == {KID}


def test_watch_repeated_data_segment_is_not_resisting():
    counter, prn, _ = _tcp_watch()
    for _ in range(10):
        prn(_frame("PA", payload=b"x" * 24))
    assert counter.resisting() == set()


def test_watch_advancing_data_segments_are_resisting():
    counter, prn, _ = _tcp_watch()
    for i in range(5):
        prn(_frame("PA", seq=i * 24, payload=b"x" * 24))
    assert counter.resisting() == {KID}


def test_watch_padding_not_counted_as_payload():
    counter, prn, _ = _tcp_watch()
    prn(_frame("A", seq=100, pad=b"\0" * 6))
    prn(_frame("A", seq=100, pad=b"\0" * 6))
    assert counter.tally(KID).from_gateway == 0
    info = counter._flows[KID][(INET, 443, KID_IP, 50000)]
    assert info[0] == 100  # end == seq: zero-length payload


def test_evidence_sample_classifies_new_and_retransmit():
    c, _ = _counter(grace=0)
    c.observe(GW, BOX, KID_IP, INET, tcp=TcpInfo(443, 5000, 100, 0, True, flags="SA"))
    c.observe(GW, BOX, KID_IP, INET, tcp=TcpInfo(443, 5000, 100, 0, True, flags="SA"))
    ev = c.evidence(KID)
    assert ev == [
        {"src": f"{INET}:443", "proto": "tcp", "flags": "SA", "class": "new"},
        {"src": f"{INET}:443", "proto": "tcp", "flags": "SA", "class": "retx"},
    ]


def test_evidence_is_capped_and_cleared_with_window():
    c, t = _counter()
    for _ in range(25):
        c.observe(GW, BOX, KID_IP, INET, proto="udp", sport=443)
    ev = c.evidence(KID)
    assert len(ev) == 10
    assert ev[0] == {"src": f"{INET}:443", "proto": "udp", "flags": "", "class": "new"}
    t[0] += 31
    assert c.evidence(KID) == []


def test_evidence_empty_under_threshold_report():
    c, _ = _counter()
    c.observe(GW, BOX, KID_IP, INET, proto="udp", sport=1)
    assert c.resisting() == set()
