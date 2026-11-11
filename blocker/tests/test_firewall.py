"""nftables render tests (pure; no root/nft needed)."""

from __future__ import annotations

import subprocess
from unittest.mock import patch

from blocker.firewall import add_pairs, kill_conntrack, render_ruleset
from blocker.service import DEFAULT_LAN_CIDRS

LAN = ["192.168.1.0/24", "fe80::/10"]


MAC = {"de:ad:be:ef:00:01"}


def test_render_blocks_v4_and_v6_to_wan_allows_lan():
    r = render_ruleset({"192.168.1.50"}, {"fe80::50"}, MAC, LAN, "192.168.1.2", 8080)
    assert "192.168.1.50" in r
    assert "fe80::50" in r
    assert "ip saddr @blocked_v4 ip daddr { 192.168.1.0/24 } accept" in r
    assert "ip6 saddr @blocked_v6 ip6 daddr { fe80::/10 } accept" in r
    assert "ip saddr @blocked_v4 drop" in r
    assert "ip6 saddr @blocked_v6 drop" in r


def test_render_drops_return_traffic_to_blocked_ips():
    # Bidirectional redirect: the spoofed gateway forwards the device's return
    # traffic to the box, which must drop it.
    r = render_ruleset({"192.168.1.50"}, {"fe80::50"}, MAC, LAN, "192.168.1.2", 8080)
    assert "ip daddr @blocked_v4 drop" in r
    assert "ip6 daddr @blocked_v6 drop" in r


def test_render_keeps_lan_to_blocked_reachable_in_order():
    r = render_ruleset({"192.168.1.50"}, {"fe80::50"}, MAC, LAN, "192.168.1.2", 8080)
    lines = [ln.strip() for ln in r.splitlines()]
    v4_lan = lines.index("ip saddr @blocked_v4 ip daddr { 192.168.1.0/24 } accept")
    v6_lan = lines.index("ip6 saddr @blocked_v6 ip6 daddr { fe80::/10 } accept")
    v4_in = lines.index("ip saddr { 192.168.1.0/24 } ip daddr @blocked_v4 accept")
    v6_in = lines.index("ip6 saddr { fe80::/10 } ip6 daddr @blocked_v6 accept")
    v4_drop = lines.index("ip daddr @blocked_v4 drop")
    v6_drop = lines.index("ip6 daddr @blocked_v6 drop")
    saddr_drop = lines.index("ether saddr @blocked_mac drop")
    assert v4_lan < v4_in < v4_drop < saddr_drop
    assert v6_lan < v6_in < v6_drop < saddr_drop


def test_render_omits_lan_to_blocked_accept_without_lan_family():
    r = render_ruleset({"192.168.1.50"}, set(), MAC, ["192.168.1.0/24"], "192.168.1.2", 80)
    assert "ip6 saddr {" not in r
    assert "ip saddr { 192.168.1.0/24 } ip daddr @blocked_v4 accept" in r


def test_render_drops_by_mac_the_authoritative_key():
    r = render_ruleset(set(), set(), MAC, LAN, "192.168.1.2", 8080)
    assert "de:ad:be:ef:00:01" in r
    assert "ether saddr @blocked_mac drop" in r  # spoof-resistant drop even with no IP


def test_render_redirects_dns_and_http_drops_https():
    r = render_ruleset({"192.168.1.50"}, set(), MAC, LAN, "192.168.1.2", 8080)
    assert "udp dport 53 dnat ip to 192.168.1.2:53" in r
    assert "tcp dport 80 dnat ip to 192.168.1.2:8080" in r
    assert "tcp dport 443 drop" in r


def test_render_omits_dnat_when_no_portal_ip():
    # No box IP -> omit dnat (an invalid target would reject the whole ruleset),
    # but the device must still be blocked by the drop rules.
    r = render_ruleset({"192.168.1.50"}, set(), MAC, LAN, "", 80)
    assert "dnat" not in r
    assert "ip saddr @blocked_v4 drop" in r
    assert "ether saddr @blocked_mac drop" in r


def test_render_empty_set_is_noop_safe():
    r = render_ruleset(set(), set(), set(), LAN, "192.168.1.2", 8080)
    assert "elements" not in r  # no elements emitted when empty
    assert r.startswith("add table inet task4ce\ndelete table inet task4ce\ntable inet task4ce {")
    assert r.rstrip().endswith("}")


def test_render_dns_to_port_53_http_to_portal_port():
    r = render_ruleset({"192.168.1.50"}, set(), MAC, LAN, "192.168.1.2", 8080)
    dns = [ln for ln in r.splitlines() if "dport 53 dnat" in ln]
    http = [ln for ln in r.splitlines() if "dport 80 dnat" in ln]
    assert len(dns) == 2 and all(ln.endswith(":53") for ln in dns)
    assert len(http) == 1 and http[0].endswith(":8080")


def test_locked_device_reaches_box_services():
    # ntfy (:2586) lives on the box's LAN address: a locked kid phone must still reach it.
    r = render_ruleset(set(), set(), MAC, DEFAULT_LAN_CIDRS, "192.168.1.2", 80)
    lines = [ln.strip() for ln in r.splitlines()]
    accept = next(
        i
        for i, ln in enumerate(lines)
        if ln.startswith("ether saddr @blocked_mac ip daddr {")
        and "172.16.0.0/12" in ln
        and ln.endswith("accept")
    )
    assert accept < lines.index("ether saddr @blocked_mac drop")
    pre = r.split("chain prerouting")[1].split("chain forward")[0]
    assert "2586" not in pre


def test_render_homework_pairs():
    """Homework pairs sets are declared and used in accept rules."""
    hw_out = {("aa:bb:cc:dd:ee:01", "8.8.8.8"), ("aa:bb:cc:dd:ee:02", "1.1.1.1")}
    hw_back = {("8.8.8.8", "192.168.1.10"), ("1.1.1.1", "192.168.1.11")}
    r = render_ruleset(
        set(), set(), set(), LAN, "192.168.1.2", 8080, hw_out=hw_out, hw_back=hw_back
    )
    assert "set hw_out { type ether_addr . ipv4_addr" in r
    assert "set hw_back { type ipv4_addr . ipv4_addr" in r
    assert "aa:bb:cc:dd:ee:01 . 8.8.8.8" in r
    assert "8.8.8.8 . 192.168.1.10" in r
    assert "ether saddr . ip daddr @hw_out accept" in r
    assert "ip saddr . ip daddr @hw_back accept" in r


def test_render_homework_pairs_accept_before_drops():
    """Homework accept rules come before the drop rules."""
    hw_out = {("aa:bb:cc:dd:ee:01", "8.8.8.8")}
    hw_back = {("8.8.8.8", "192.168.1.10")}
    r = render_ruleset(
        {"192.168.1.50"}, set(), MAC, LAN, "192.168.1.2", 8080, hw_out=hw_out, hw_back=hw_back
    )
    lines = [ln.strip() for ln in r.splitlines()]
    hw_out_idx = lines.index("ether saddr . ip daddr @hw_out accept")
    hw_back_idx = lines.index("ip saddr . ip daddr @hw_back accept")
    mac_drop_idx = lines.index("ether saddr @blocked_mac drop")
    assert hw_out_idx < mac_drop_idx and hw_back_idx < mac_drop_idx


def test_render_homework_http_to_allowed_ip_skips_portal():
    """HTTP to an allowed homework IP must not be hijacked by the port-80 portal DNAT."""
    r = render_ruleset({"192.168.1.50"}, set(), MAC, LAN, "192.168.1.2", 8080)
    lines = [ln.strip() for ln in r.splitlines()]
    skip = lines.index("ether saddr . ip daddr @hw_out tcp dport 80 return")
    assert skip < next(i for i, ln in enumerate(lines) if "tcp dport 80 dnat" in ln)


def test_render_empty_homework_pairs():
    """Empty homework pairs sets are declared but with no elements."""
    r = render_ruleset(set(), set(), set(), LAN, "192.168.1.2", 8080, hw_out=set(), hw_back=set())
    assert "set hw_out { type ether_addr . ipv4_addr;" in r
    assert "set hw_back { type ipv4_addr . ipv4_addr;" in r
    # Sets should be declared but rules still present
    assert "ether saddr . ip daddr @hw_out accept" in r
    assert "ip saddr . ip daddr @hw_back accept" in r


def test_add_pairs_empty_does_nothing():
    """add_pairs with empty sets does nothing."""
    with patch("blocker.firewall.subprocess.run") as mock_run:
        add_pairs(set(), set())
        mock_run.assert_not_called()


def test_add_pairs_refreshes_with_timeouts_in_one_batch():
    """add_pairs replaces each element (add; delete; add timeout) in a single nft batch."""
    with patch("blocker.firewall.subprocess.run") as mock_run:
        add_pairs({("aa:bb:cc:dd:ee:01", "8.8.8.8"): 900}, {("8.8.8.8", "192.168.1.10"): 900})
    assert mock_run.call_count == 1
    assert mock_run.call_args[0][0] == ["nft", "-f", "-"]
    batch = mock_run.call_args[1]["input"].decode().splitlines()
    assert batch == [
        "add element inet task4ce hw_out { aa:bb:cc:dd:ee:01 . 8.8.8.8 }",
        "delete element inet task4ce hw_out { aa:bb:cc:dd:ee:01 . 8.8.8.8 }",
        "add element inet task4ce hw_out { aa:bb:cc:dd:ee:01 . 8.8.8.8 timeout 900s }",
        "add element inet task4ce hw_back { 8.8.8.8 . 192.168.1.10 }",
        "delete element inet task4ce hw_back { 8.8.8.8 . 192.168.1.10 }",
        "add element inet task4ce hw_back { 8.8.8.8 . 192.168.1.10 timeout 900s }",
    ]


def test_add_pairs_drops_malformed_elements():
    """Nothing that isn't a MAC / dotted IPv4 ever reaches the nft batch text."""
    evil = {("aa:bb:cc:dd:ee:01", "1.2.3.4 } ; flush ruleset ; {"): 60, ("x", "1.1.1.1"): 60}
    with patch("blocker.firewall.subprocess.run") as mock_run:
        add_pairs(evil, {("1.1.1.1", "not-an-ip"): 60})
    mock_run.assert_not_called()


def test_render_homework_sets_have_timeouts():
    hw_out = {("aa:bb:cc:dd:ee:01", "8.8.8.8"): 123}
    hw_back = {("8.8.8.8", "192.168.1.10"): 123, ("8.8.8.8", "evil }"): 5}
    r = render_ruleset(
        set(), set(), set(), LAN, "192.168.1.2", 8080, hw_out=hw_out, hw_back=hw_back
    )
    assert "flags timeout;" in r.split("set hw_out")[1].split("\n")[0]
    assert "aa:bb:cc:dd:ee:01 . 8.8.8.8 timeout 123s" in r
    assert "8.8.8.8 . 192.168.1.10 timeout 123s" in r
    assert "evil" not in r


def test_kill_conntrack_scoped_to_device():
    """Remote-IP deletions are always paired with the device IP (both directions)."""
    with patch("blocker.firewall.subprocess.run") as mock_run:
        kill_conntrack({"8.8.8.8"}, "192.168.1.10")
    calls = [c[0][0] for c in mock_run.call_args_list]
    assert calls == [
        ["conntrack", "-D", "-s", "192.168.1.10", "-d", "8.8.8.8"],
        ["conntrack", "-D", "-s", "8.8.8.8", "-d", "192.168.1.10"],
    ]


def test_kill_conntrack_whole_device_when_no_ips():
    with patch("blocker.firewall.subprocess.run") as mock_run:
        kill_conntrack(set(), "192.168.1.10")
    assert [c[0][0] for c in mock_run.call_args_list] == [["conntrack", "-D", "-s", "192.168.1.10"]]


def test_kill_conntrack_skips_without_valid_device_ip():
    """Unknown device -> never a bare `-d <remote>` that would cut other LAN hosts."""
    with patch("blocker.firewall.subprocess.run") as mock_run:
        kill_conntrack({"8.8.8.8"}, None)
        kill_conntrack({"8.8.8.8"}, "-F")
        kill_conntrack({"-F", "8.8.8.8 -x"}, "192.168.1.10")
    mock_run.assert_not_called()


def test_kill_conntrack_tolerates_status_1():
    """kill_conntrack ignores exit status 1 from conntrack."""
    with patch("blocker.firewall.subprocess.run") as mock_run:
        mock_run.side_effect = subprocess.CalledProcessError(1, "conntrack")
        # Should not raise
        kill_conntrack({"8.8.8.8"}, "192.168.1.10")
