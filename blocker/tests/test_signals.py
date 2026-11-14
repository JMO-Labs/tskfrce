"""Signals: DHCP fingerprint, mDNS parsing, change-only reporting."""

from __future__ import annotations

import time
from pathlib import Path
from unittest.mock import Mock

from blocker.backend import Seen
from blocker.config import Config
from blocker.signals import (
    Signals,
    dhcp_fp_from_packet,
    dhcp_hostname_from_packet,
    mdns_from_packet,
)
from scapy.all import BOOTP, DHCP, DNS, DNSRR, IP, UDP, Ether

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


def _mdns(rdata="10.0.0.5", src="10.0.0.5", qr=1, txt=True, mac=MAC):
    an = [DNSRR(rrname="Bobbys-iPad.local.", type="A", rdata=rdata)]
    if txt:
        an.append(DNSRR(rrname="x._airplay._tcp.local.", type="TXT", rdata=[b"model=iPad13,1"]))
    pkt = (
        Ether(src=mac)
        / IP(src=src, dst="224.0.0.251")
        / UDP(sport=5353, dport=5353)
        / DNS(qr=qr, an=an)
    )
    return Ether(bytes(pkt))  # dissect as on the wire


def test_mdns_genuine():
    assert mdns_from_packet(_mdns()) == (MAC, "Bobbys-iPad", "iPad13,1")


def test_mdns_no_model():
    assert mdns_from_packet(_mdns(txt=False)) == (MAC, "Bobbys-iPad", None)


def test_mdns_spoofed_rdata_ignored():
    assert mdns_from_packet(_mdns(rdata="10.0.0.9")) is None


def test_mdns_query_ignored():
    assert mdns_from_packet(_mdns(qr=0)) is None


def test_mdns_garbage():
    assert mdns_from_packet(object()) is None
    assert mdns_from_packet(Ether() / IP()) is None


def _sg():
    sg = Signals(CFG, Mock())
    sg.note_seen(Seen(mac=MAC, ip="10.0.0.5", ipv6=[], hostname=None, vendor=None))
    sg.update = Mock()
    return sg


def test_on_mdns_genuine_updates():
    sg = _sg()
    sg._on_mdns(_mdns())
    sg.update.assert_called_once_with(MAC, mdns_name="Bobbys-iPad", model="iPad13,1")


def test_on_mdns_sender_mac_mismatch():
    sg = _sg()
    sg._on_mdns(_mdns(mac="aa:bb:cc:dd:ee:99"))
    sg.update.assert_not_called()


def test_on_mdns_spoof_and_garbage_no_update():
    sg = _sg()
    sg._on_mdns(_mdns(rdata="10.0.0.9"))
    sg._on_mdns(object())
    sg.update.assert_not_called()


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


def test_query_mdns_sends_ptr_for_each_type(monkeypatch):
    from blocker import scapy_lite as sa
    from blocker import signals as sig

    sent = []
    monkeypatch.setattr(sa, "send", lambda pkt, **kw: sent.append(pkt))
    s = sig.Signals.__new__(sig.Signals)
    s.cfg = CFG
    s._ifaces = lambda: ["wlo1"]
    s._query_mdns()
    (pkt,) = sent
    assert pkt[sa.IP].dst == "224.0.0.251"
    names = {q.qname.decode() for q in pkt[sa.DNS].qd}
    assert names == set(sig.MDNS_TYPES)


def _req(*opts, src=MAC):
    return (
        Ether(src=src, dst="ff:ff:ff:ff:ff:ff")
        / IP(src="0.0.0.0", dst="255.255.255.255")
        / UDP(sport=68, dport=67)
        / BOOTP(chaddr=bytes.fromhex(MAC.replace(":", "")))
        / DHCP(options=[("message-type", "request"), *opts, "end"])
    )


def test_dhcp_hostname_option12():
    assert dhcp_hostname_from_packet(_req(("hostname", b"bobby-laptop"))) == (MAC, "bobby-laptop")


def test_dhcp_hostname_option81_wire_format():
    fqdn = ("client_FQDN", b"\x05\x00\x00\x08bobby-pc\x04home\x00")
    assert dhcp_hostname_from_packet(_req(fqdn)) == (MAC, "bobby-pc")
    bad = ("client_FQDN", b"\x04\x00\x00\x20abc")
    assert dhcp_hostname_from_packet(_req(bad)) is None


def test_dhcp_hostname_option81_host_part_only_when_12_absent():
    fqdn = ("client_FQDN", b"\x00\x00\x00bobby-pc.home.lan")
    assert dhcp_hostname_from_packet(_req(fqdn)) == (MAC, "bobby-pc")
    both = _req(("hostname", b"x12"), fqdn)
    assert dhcp_hostname_from_packet(both) == (MAC, "x12")


def test_dhcp_hostname_spoofed_chaddr_ignored():
    pkt = _req(("hostname", b"evil"), src="aa:bb:cc:dd:ee:99")
    assert dhcp_hostname_from_packet(pkt) is None


def test_dhcp_hostname_sanitized():
    got = dhcp_hostname_from_packet(_req(("hostname", b"bo\x00b\x07by\n")))
    assert got == (MAC, "bobby")
    assert dhcp_hostname_from_packet(_req(("hostname", b"\x01\x02"))) is None
    got = dhcp_hostname_from_packet(_req(("hostname", b"a" * 100)))
    assert got == (MAC, "a" * 63)


def test_dhcp_hostname_reported_via_update():
    rep = Mock()
    sg = Signals(CFG, rep)
    sg.note_seen(Seen(mac=MAC, ip="10.0.0.5", ipv6=[], hostname=None, vendor="v"))
    assert sg.update(MAC, dhcp_hostname="bobby")
    assert rep.call_args[0][1].body()["dhcp_hostname"] == "bobby"


def _fake_sniffers(sg, made):
    class FakeSniffer:
        def __init__(self, iface, filt, prn):
            self.iface, self.filt, self.prn, self.stopped = iface, filt, prn, False
            made.append(self)

        def start(self):
            pass

        def stop(self):
            self.stopped = True

    sg._make_sniffer = lambda i, f, p: FakeSniffer(i, f, p)


def _two_nic():
    """Two NICs: eno2 and wlo1 both managed; sniffers recorded."""
    made = []
    sg = Signals(CFG, Mock(), ifaces=lambda: ["eno2", "wlo1"])
    _fake_sniffers(sg, made)
    return sg, made


def test_dhcp_sniffs_each_managed_iface_and_sets_fp():
    import threading

    sg, made = _two_nic()
    sg.note_seen(Seen(mac=MAC, ip="10.10.40.7", ipv6=[], hostname=None, vendor=None))
    stop = threading.Event()
    t = threading.Thread(target=sg.run_dhcp, args=(stop,))
    t.start()
    for _ in range(100):
        if len(made) >= 2:
            break
        time.sleep(0.01)
    assert sorted(m.iface for m in made) == ["eno2", "wlo1"]
    next(m for m in made if m.iface == "wlo1").prn(_req(("param_req_list", [1, 121, 3, 6])))
    stop.set()
    t.join(5)
    assert sg._cache[MAC]["dhcp_fp"] == "1,121,3,6"
    assert all(m.stopped for m in made)


def test_sniffers_follow_iface_changes():
    import threading

    ifs = ["eno2"]
    made = []
    sg = Signals(CFG, Mock(), ifaces=lambda: list(ifs))
    _fake_sniffers(sg, made)
    stop = threading.Event()
    t = threading.Thread(target=sg._sniff_managed, args=(stop, "f", None, 0.01))
    t.start()

    def wait(cond):
        for _ in range(300):
            if cond():
                return
            time.sleep(0.01)
        raise AssertionError("timeout")

    wait(lambda: len(made) == 1)
    ifs.append("wlo1")
    wait(lambda: len(made) == 2)
    assert made[1].iface == "wlo1"
    ifs.remove("eno2")
    wait(lambda: made[0].stopped)
    assert not made[1].stopped
    stop.set()
    t.join(5)


def test_single_iface_mode_only_lan_iface(monkeypatch):
    import threading

    from blocker import scapy_lite as sa

    cfg = Config("http://b", "b", "t", "eth0", Path("/tmp"))
    sg = Signals(cfg, Mock(), ifaces=lambda: ["eth0", "wlo1"])
    made = []
    _fake_sniffers(sg, made)
    stop = threading.Event()
    t = threading.Thread(target=sg._sniff_managed, args=(stop, "f", None, 0.01))
    t.start()
    for _ in range(100):
        if made:
            break
        time.sleep(0.01)
    time.sleep(0.05)
    stop.set()
    t.join(5)
    assert [m.iface for m in made] == ["eth0"]
    sent = []
    monkeypatch.setattr(sa, "send", lambda pkt, **kw: sent.append(kw["iface"]))
    sg._query_mdns()
    assert sent == ["eth0"]


def test_query_mdns_sent_on_every_managed_iface(monkeypatch):
    from blocker import scapy_lite as sa

    sent = []
    monkeypatch.setattr(sa, "send", lambda pkt, **kw: sent.append(kw["iface"]))
    sg = Signals(CFG, Mock(), ifaces=lambda: ["wlo1", "wlan1"])
    sg._query_mdns()
    assert sent == ["wlo1", "wlan1"]
