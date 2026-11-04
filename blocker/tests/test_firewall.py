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
    assert r.startswith("add table inet task4ce\nflush table inet task4ce\ntable inet task4ce {")
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
    r = render_ruleset(set(), set(), set(), LAN, "192.168.1.2", 8080, hw_out=hw_out, hw_back=hw_back)
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
    r = render_ruleset({"192.168.1.50"}, set(), MAC, LAN, "192.168.1.2", 8080, hw_out=hw_out, hw_back=hw_back)
    lines = [ln.strip() for ln in r.splitlines()]
    hw_out_idx = lines.index("ether saddr . ip daddr @hw_out accept")
    hw_back_idx = lines.index("ip saddr . ip daddr @hw_back accept")
    mac_drop_idx = lines.index("ether saddr @blocked_mac drop")
    assert hw_out_idx < mac_drop_idx and hw_back_idx < mac_drop_idx


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


def test_add_pairs_command():
    """add_pairs builds the correct nft command."""
    hw_out = {("aa:bb:cc:dd:ee:01", "8.8.8.8"), ("aa:bb:cc:dd:ee:02", "1.1.1.1")}
    hw_back = {("8.8.8.8", "192.168.1.10"), ("1.1.1.1", "192.168.1.11")}
    with patch("blocker.firewall.subprocess.run") as mock_run:
        add_pairs(hw_out, hw_back)
        assert mock_run.call_count == 2
        calls = [c[0][0] for c in mock_run.call_args_list]
        # Check that both nft add element commands are called
        assert any("nft" in str(c) and "hw_out" in str(c) for c in calls)
        assert any("nft" in str(c) and "hw_back" in str(c) for c in calls)


def test_kill_conntrack_command():
    """kill_conntrack builds the correct conntrack command."""
    with patch("blocker.firewall.subprocess.run") as mock_run:
        kill_conntrack({"8.8.8.8", "1.1.1.1"}, "192.168.1.10")
        # Should call conntrack for the device IP and each remote IP
        assert mock_run.call_count >= 2
        calls = [c[0][0] for c in mock_run.call_args_list]
        assert any("conntrack" in str(c) and "192.168.1.10" in str(c) for c in calls)
        assert any("conntrack" in str(c) and "8.8.8.8" in str(c) for c in calls)


def test_kill_conntrack_tolerates_status_1():
    """kill_conntrack ignores exit status 1 from conntrack."""
    with patch("blocker.firewall.subprocess.run") as mock_run:
        mock_run.side_effect = subprocess.CalledProcessError(1, "conntrack")
        # Should not raise
        kill_conntrack({"8.8.8.8"}, "192.168.1.10")
