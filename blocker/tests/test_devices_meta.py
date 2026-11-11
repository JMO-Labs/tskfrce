"""Device metadata: gateway/box MAC enrichment."""

from blocker.backend import Seen
from blocker.devices_meta import enrich_seen_with_gateway_and_box


def test_enrich_seen_adds_gateway_and_box():
    """enrich_seen_with_gateway_and_box adds MACs to Seen before reporting."""
    seen = Seen(
        mac="aa:bb:cc:dd:ee:01", ip="192.168.1.10", ipv6=[], hostname="test", vendor="Apple"
    )
    result = enrich_seen_with_gateway_and_box(seen, "ff:ff:ff:ff:ff:ff", "11:22:33:44:55:66")

    assert result.gateway_mac == "ff:ff:ff:ff:ff:ff"
    assert result.box_mac == "11:22:33:44:55:66"
    assert result.mac == "aa:bb:cc:dd:ee:01"


def test_enrich_seen_handles_none_gateway():
    """enrich_seen_with_gateway_and_box handles None gateway_mac."""
    seen = Seen(mac="aa:bb:cc:dd:ee:01", ip="192.168.1.10", ipv6=[], hostname="test", vendor=None)
    result = enrich_seen_with_gateway_and_box(seen, None, "11:22:33:44:55:66")

    assert result.gateway_mac is None
    assert result.box_mac == "11:22:33:44:55:66"
