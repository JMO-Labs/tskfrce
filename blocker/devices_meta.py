"""Device metadata: extract gateway/box MACs from network facts."""

from dataclasses import replace

from blocker.backend import Seen


def enrich_seen_with_gateway_and_box(seen: Seen, gateway_mac: str | None, box_mac: str) -> Seen:
    """Attach gateway/box MACs to Seen before reporting to backend.

    Blocker knows these from LAN facts; backend needs them to filter the device list.
    """
    return replace(seen, gateway_mac=gateway_mac or None, box_mac=box_mac)
