import pytest
from blocker.workaround import CATEGORIES, WorkaroundCounter, categorize


def test_categorize():
    assert categorize("api.nordvpn.com.") == "vpn"
    assert categorize("DNS.GOOGLE") == "private_dns"
    assert categorize("notnordvpn.com") is None
    assert categorize("www.torproject.org") == "tor"
    assert categorize("croxyproxy.com") == "proxy"
    assert categorize("example.com") is None


def test_counter_groups_by_mac():
    c = WorkaroundCounter({"1.1.1.1": "aa:bb"}.get)
    for q in ("api.nordvpn.com.", "x.surfshark.com.", "torproject.org."):
        c.add("1.1.1.1", q)
    c.add("1.1.1.1", "example.com.")
    assert c.drain() == {"aa:bb": ["tor", "vpn"]}
    assert c.drain() == {}


def test_unknown_ip_ignored():
    c = WorkaroundCounter(lambda ip: None)
    c.add("1.1.1.1", "nordvpn.com.")
    assert c.drain() == {}


def test_counter_bounds_macs():
    c = WorkaroundCounter(lambda ip: ip)
    for i in range(1100):
        c.add(f"m{i}", "nordvpn.com.")
    assert len(c.drain()) == 1000


def test_categories_only_known():
    from blocker.workaround import _entries

    assert {cat for cat, _ in _entries()} <= {*CATEGORIES, "ignore"}
    assert len(_entries()) >= 100


def test_qname_of():
    pytest.importorskip("scapy")
    from blocker.portal import qname_of
    from scapy.layers.dns import DNS, DNSQR

    assert qname_of(bytes(DNS(rd=1, qd=DNSQR(qname="example.com")))) == "example.com."
    assert qname_of(b"\x00garbage") is None


@pytest.mark.parametrize(
    "name",
    [
        "google.com",
        "icloud.com",
        "mask.icloud.com",
        "use-application-dns.net",
        "mozilla.cloudflare-dns.com.",
        "chrome.cloudflare-dns.com",
        "doh.dns.sb",
        "controlplane.tailscale.com",
        "log.tailscale.io",
        "x.luminati.io",
    ],
)
def test_background_names_not_flagged(name):
    assert categorize(name) is None


def test_ignore_keeps_parent_flagged():
    assert categorize("cloudflare-dns.com") == "private_dns"
    assert categorize("dns.sb") == "private_dns"


def _clock():
    t = [100.0]
    return t, (lambda: t[0])


def test_private_dns_lookup_alone_is_silent():
    t, now = _clock()
    c = WorkaroundCounter({"1.1.1.1": "aa:bb"}.get, clock=now)
    c.add("1.1.1.1", "cloudflare-dns.com.")  # app-embedded DoH: only :443 follows
    t[0] += 30
    assert c.drain() == {}


def test_private_dns_confirmed_by_dot_syn():
    t, now = _clock()
    c = WorkaroundCounter({"1.1.1.1": "aa:bb"}.get, clock=now)
    c.add("1.1.1.1", "dns.google.")
    t[0] += 3
    c.dot("aa:bb")
    assert c.drain() == {"aa:bb": ["private_dns"]}


def test_dot_after_window_or_without_lookup_ignored():
    t, now = _clock()
    c = WorkaroundCounter({"1.1.1.1": "aa:bb"}.get, clock=now)
    c.dot("aa:bb")
    c.add("1.1.1.1", "dns.google.")
    t[0] += 11
    c.dot("aa:bb")
    assert c.drain() == {}


def test_other_categories_unaffected_by_pending():
    c = WorkaroundCounter({"1.1.1.1": "aa:bb"}.get)
    c.add("1.1.1.1", "dns.google.")
    c.add("1.1.1.1", "nordvpn.com.")
    assert c.drain() == {"aa:bb": ["vpn"]}


def test_dot_mac_case_insensitive():
    _t, now = _clock()
    c = WorkaroundCounter({"1.1.1.1": "AA:BB"}.get, clock=now)
    c.add("1.1.1.1", "dns.google.")
    c.dot("aa:bb")
    assert c.drain() == {"aa:bb": ["private_dns"]}


def test_dot_bounds_macs():
    _t, now = _clock()
    c = WorkaroundCounter({"1.1.1.1": "aa:bb"}.get, clock=now)
    c.add("1.1.1.1", "dns.google.")
    for i in range(1000):
        c._found[f"m{i}"] = {"vpn"}
    c.dot("aa:bb")
    assert "aa:bb" not in c.drain()
