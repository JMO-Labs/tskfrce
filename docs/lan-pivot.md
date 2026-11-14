# LAN pivot: paused device uses a sibling device as a proxy

A paused kid's device may reach the internet through another device on the
same network (an old phone running a proxy, a hotspot-over-LAN, a laptop
sharing its connection). This note records the options and the decision.
Investigation: tskfrce#86.

## Why the box can't see same-subnet pivots

The box blocks a paused device by ARP/NDP-redirecting the **gateway** mapping
(`blocker/arp.py`, `redirect_packets`). A paused phone talking to a sibling on
the **same subnet** resolves that peer's MAC directly. The frames travel
L2-direct and never reach the box, so no firewall rule can see or drop them.

The forward-chain LAN accepts (`blocker/firewall.py`, `DEFAULT_LAN_CIDRS` in
`blocker/service.py`: RFC1918/ULA) only apply to traffic routed through the
box: cross-VLAN or multi-network setups (`multinet.py`, `vlan.py`).

## Options

| Option | Works same-subnet? | False-positive risk |
|---|---|---|
| **A. Strict forward**: paused devices reach only DHCP/mDNS/casting ports | No, routed/VLAN flows only | **High.** Casting, printing, SMB/NAS use varied, dynamic ports. Would break TVs and consoles that can't handle portals. |
| **B. High-volume paused→LAN alert**: sustained large paused→LAN flows | No, routed flows only | **Medium.** Casting, NAS backups. |
| **C. Activity-without-portal-hits alert**: paused device looks active (ARP/DHCP/mDNS, proxy ports or DNS names seen by `workaround.py`) but has no portal hits or dropped flows | Indirectly | **Medium-low** if worded "may". |
| **D. Docs only** (status quo) | n/a | None. |

## Recommendation

- **No blocking mode.** Option A is rejected: it can't stop the common case
  and risks breaking devices.
- Keep **D** as the baseline.
- Optionally offer **B** as an **alert only**, **default OFF**, scoped to
  **routed flows only**, with "may" wording ("<name> may be using another
  device to get online") and **at most once per device per pause**, in line
  with the bypass-alerts anti-goals
  (`docs/superpowers/specs/2026-11-05-bypass-alerts-design.md`).
- C is not planned; revisit if B proves useful.

## Off-box mitigations

For same-subnet pivots the fix has to happen outside the box:

- Put kids' devices on a separate SSID/VLAN or enable AP **client isolation**
  so they can't reach siblings directly.
- Lock down hotspot/proxy/tethering apps on the sibling devices (Family Link /
  Screen Time, remove old phones from the network).
- Use a router that supports per-device internet pause as well.
