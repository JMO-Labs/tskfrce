"""Spec A2/A3: only real home networks count; one portal per address, following changes."""

import json
import threading
import time

from blocker.ifaces import PerAddress, is_lan_ip, parse


def link(name, ip, kind=None):
    d = {"ifname": name, "addr_info": [{"family": "inet", "local": ip}]}
    if kind:
        d["linkinfo"] = {"info_kind": kind}
    return d


def test_filter_keeps_physical_wifi_and_vlan_only(tmp_path):
    for nic in ("eno2", "wlo1"):
        (tmp_path / nic / "device").mkdir(parents=True)
    links = [
        link("eno2", "192.168.1.98"),
        link("wlo1", "10.0.5.20"),
        link("eno2.30", "172.20.30.5", kind="vlan"),
        link("lo", "127.0.0.1"),
        link("docker0", "172.17.0.1"),
        link("br-a72b38255f2f", "172.29.50.1"),
        link("veth4df773d", "172.29.50.9"),
        link("tailscale0", "100.101.1.2"),
        link("wg0", "10.8.0.1"),
        link("wlo1-hotspot", "10.42.0.1"),
        link("enx1", "8.8.4.4"),  # public: never a home LAN (and no device dir anyway)
    ]
    assert parse(json.dumps(links), tmp_path) == [
        ("eno2", "192.168.1.98"),
        ("wlo1", "10.0.5.20"),
        ("eno2.30", "172.20.30.5"),
    ]


def test_hotspot_linklocal_cgnat_public_excluded():
    assert is_lan_ip("192.168.1.2") and is_lan_ip("10.1.2.3") and is_lan_ip("172.31.0.1")
    for ip in ("10.42.0.1", "169.254.3.3", "100.64.0.1", "8.8.8.8", "172.32.0.1"):
        assert not is_lan_ip(ip)


def test_wifi_only_box_still_counts(tmp_path):
    (tmp_path / "wlo1" / "device").mkdir(parents=True)
    assert parse(json.dumps([link("wlo1", "192.168.4.7")]), tmp_path) == [("wlo1", "192.168.4.7")]


def test_per_address_starts_and_stops_with_the_network():
    addrs = [("eno2", "192.168.1.98")]
    live, stopped = set(), set()

    def serve(ip, ev):
        live.add(ip)
        ev.wait()
        stopped.add(ip)

    pa = PerAddress(serve, addrs=lambda: list(addrs))
    pa.sync()
    addrs.append(("wlo1", "10.0.5.20"))
    pa.sync()
    time.sleep(0.05)
    assert live == {"192.168.1.98", "10.0.5.20"}
    addrs.pop(0)  # cable unplugged
    pa.sync()
    time.sleep(0.05)
    assert stopped == {"192.168.1.98"} and set(pa.running) == {"10.0.5.20"}


def test_failed_bind_is_retried_next_sync():
    tries = []

    def serve(ip, ev):
        tries.append(ip)
        if len(tries) == 1:
            raise OSError("address in use")
        ev.wait()

    pa = PerAddress(serve, addrs=lambda: [("eno2", "192.168.1.98")])
    pa.sync()
    time.sleep(0.05)
    pa.sync()
    time.sleep(0.05)
    assert tries == ["192.168.1.98", "192.168.1.98"]
    stop = threading.Event()
    stop.set()
    pa.run(stop)


def test_host_bridge_and_bond_count_but_docker_bridges_dont(tmp_path):
    links = [
        link("br0", "192.168.1.10", kind="bridge"),
        link("bond0", "10.0.0.2", kind="bond"),
        link("docker0", "172.17.0.1", kind="bridge"),
        link("br-a72b38255f2f", "172.29.50.1", kind="bridge"),
    ]
    assert parse(json.dumps(links), tmp_path) == [("br0", "192.168.1.10"), ("bond0", "10.0.0.2")]


def test_crash_other_than_oserror_is_retried():
    tries = []

    def serve(ip, ev):
        tries.append(ip)
        if len(tries) == 1:
            raise RuntimeError("boom")
        ev.wait()

    pa = PerAddress(serve, addrs=lambda: [("eno2", "192.168.1.98")])
    pa.sync()
    time.sleep(0.05)
    pa.sync()
    time.sleep(0.05)
    assert len(tries) == 2
    for ev in pa.running.values():
        ev.set()


def test_iface_for_ip_uses_subnets(tmp_path):
    from blocker.ifaces import iface_for_ip, parse_networks

    for nic in ("eno2", "wlo1"):
        (tmp_path / nic / "device").mkdir(parents=True)
    links = [
        {
            "ifname": "eno2",
            "addr_info": [{"family": "inet", "local": "192.168.1.98", "prefixlen": 24}],
        },
        {
            "ifname": "wlo1",
            "addr_info": [{"family": "inet", "local": "10.0.5.20", "prefixlen": 24}],
        },
    ]
    nets = parse_networks(json.dumps(links), tmp_path)
    assert iface_for_ip("192.168.1.50", nets) == "eno2"
    assert iface_for_ip("10.0.5.7", nets) == "wlo1"
    assert iface_for_ip("172.16.0.9", nets) is None
    assert iface_for_ip(None, nets) is None
