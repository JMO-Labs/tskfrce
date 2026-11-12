"""nftables ruleset manager.

``render_ruleset`` is pure text. ``apply``/``flush``/``enable_forwarding`` do I/O
and run only under @integration tests (they need root + nft on a real host).
Everything fails open: ``flush`` removes our table so a dead blocker never bricks
the LAN.
"""

from __future__ import annotations

import ipaddress
import logging
import re
import subprocess
from collections.abc import Iterable, Mapping

log = logging.getLogger(__name__)

TABLE = "task4ce"
from blocker.sni_gate import GATE_PORT

DNS_PORT = 53


_MAC = re.compile(r"^([0-9a-f]{2}:){5}[0-9a-f]{2}$")
HW_DEFAULT_SECS = 300  # element timeout when a caller passes bare pairs


def _ip4(ip: str) -> bool:
    try:
        return str(ipaddress.IPv4Address(ip)) == ip
    except ValueError:
        return False


def _hw_elems(pairs: Mapping | Iterable, out: bool) -> list[str]:
    """`a . b timeout Ns` elements for validated pairs; anything malformed is dropped.

    pairs: {(a, b): seconds} or bare (a, b) tuples. The timeout makes nft expire an
    element on its own, so a pair never outlives the gate even if no re-render happens.
    """
    items = pairs.items() if isinstance(pairs, Mapping) else ((p, None) for p in pairs)
    elems = []
    for (a, b), secs in items:
        ok = (_MAC.match(a) if out else _ip4(a)) and _ip4(b)
        if not ok:
            log.warning("dropping malformed homework pair %r", (a, b))
            continue
        t = max(1, int(secs)) if secs is not None else HW_DEFAULT_SECS
        elems.append(f"{a} . {b} timeout {t}s")
    return sorted(elems)


def _hw_set_decl(name: str, typ: str, elems: list[str]) -> str:
    body = f" elements = {{ {', '.join(elems)} }}" if elems else ""
    return f"  set {name} {{ type {typ}; flags timeout;{body} }}"


def _set_decl(name: str, typ: str, elements: set[str]) -> str:
    if elements:
        body = " elements = { " + ", ".join(sorted(elements)) + " }"
    else:
        body = ""
    return f"  set {name} {{ type {typ};{body} }}"


def render_ruleset(
    blocked_v4: set[str],
    blocked_v6: set[str],
    blocked_mac: set[str],
    lan_cidrs: list[str],
    portal_ip: str,
    portal_port: int,
    hw_out: Mapping | Iterable = frozenset(),
    hw_back: Mapping | Iterable = frozenset(),
) -> str:
    """Build the `table inet task4ce` text. Empty sets => matches nothing (noop-safe).

    Enforcement is keyed on MAC (`blocked_mac`), the app's authoritative block key:
    a device cannot evade its block by renumbering its IP. The IP sets drive the
    captive-portal redirect (which needs L3) and add defence in depth.
    """
    v4_lan = [c for c in lan_cidrs if ":" not in c]
    v6_lan = [c for c in lan_cidrs if ":" in c]
    # delete (not flush) inside the same atomic batch: a set whose declaration changed
    # (e.g. gained `flags timeout`) would otherwise fail the WHOLE load with EEXIST.
    lines = [f"add table inet {TABLE}", f"delete table inet {TABLE}", f"table inet {TABLE} {{"]
    lines.append(_set_decl("blocked_v4", "ipv4_addr", blocked_v4))
    lines.append(_set_decl("blocked_v6", "ipv6_addr", blocked_v6))
    lines.append(_set_decl("blocked_mac", "ether_addr", blocked_mac))
    # Homework mode pairs: (MAC, remote IP) and (remote IP, device IP)
    lines.append(_hw_set_decl("hw_out", "ether_addr . ipv4_addr", _hw_elems(hw_out, out=True)))
    lines.append(_hw_set_decl("hw_back", "ipv4_addr . ipv4_addr", _hw_elems(hw_back, out=False)))
    # Redirect blocked HTTP/DNS to the captive portal; HTTPS can't be portal-ed, so drop it.
    # With a box IP, dnat there. Without one (multi-network: one portal per interface address),
    # `redirect` sends to the address of the interface the packet arrived on. Never dnat to an
    # empty target: `nft -f` would reject the WHOLE ruleset and drop all enforcement.
    lines.append("  chain prerouting {")
    lines.append("    type nat hook prerouting priority -100; policy accept;")
    dns_to = f"dnat ip to {portal_ip}:{DNS_PORT}" if portal_ip else f"redirect to :{DNS_PORT}"
    web_to = f"dnat ip to {portal_ip}:{portal_port}" if portal_ip else f"redirect to :{portal_port}"
    lines.append(f"    ip saddr @blocked_v4 udp dport 53 {dns_to}")
    lines.append(f"    ip saddr @blocked_v4 tcp dport 53 {dns_to}")
    # Homework: HTTP to an allowed IP goes through (DNS stays on the portal resolver)
    lines.append("    ether saddr . ip daddr @hw_out tcp dport 80 return")
    lines.append(f"    ip saddr @blocked_v4 tcp dport 80 {web_to}")
    # HTTPS leaving the box (not to its own pages) goes through the SNI gate (sni_gate.py)
    lines.append("    ether saddr . ip daddr @hw_out tcp dport 443 return")
    lines.append(
        f"    ip saddr @blocked_v4 fib daddr type != local tcp dport 443 redirect to :{GATE_PORT}"
    )
    lines.append("  }")
    lines.append("  chain forward {")
    lines.append("    type filter hook forward priority 0; policy accept;")
    # Homework mode accepts: these must come BEFORE the drop rules
    lines.append("    ether saddr . ip daddr @hw_out accept")
    lines.append("    ip saddr . ip daddr @hw_back accept")
    if v4_lan:
        lines.append(f"    ether saddr @blocked_mac ip daddr {{ {', '.join(v4_lan)} }} accept")
        lines.append(f"    ip saddr @blocked_v4 ip daddr {{ {', '.join(v4_lan)} }} accept")
    if v6_lan:
        lines.append(f"    ether saddr @blocked_mac ip6 daddr {{ {', '.join(v6_lan)} }} accept")
        lines.append(f"    ip6 saddr @blocked_v6 ip6 daddr {{ {', '.join(v6_lan)} }} accept")
    # Bidirectional redirect: traffic we are asked to forward TO a blocked IP can
    # only come from the spoofed gateway, so drop it — the return path that closes
    # the kid-side bypass. But first let LAN hosts keep reaching the device: a LAN
    # source to a blocked IP is local traffic we must not break (printers, casting,
    # the parent's own access), only internet-sourced returns are the signal.
    if v4_lan:
        lines.append(f"    ip saddr {{ {', '.join(v4_lan)} }} ip daddr @blocked_v4 accept")
    lines.append("    ip daddr @blocked_v4 drop")
    if v6_lan:
        lines.append(f"    ip6 saddr {{ {', '.join(v6_lan)} }} ip6 daddr @blocked_v6 accept")
    lines.append("    ip6 daddr @blocked_v6 drop")
    # Primary: drop by authoritative MAC (spoof-resistant). Secondary: drop by IP.
    lines.append("    ether saddr @blocked_mac drop")
    lines.append("    ip saddr @blocked_v4 tcp dport 443 drop")
    lines.append("    ip6 saddr @blocked_v6 tcp dport 443 drop")
    lines.append("    ip saddr @blocked_v4 drop")
    lines.append("    ip6 saddr @blocked_v6 drop")
    lines.append("  }")
    lines.append("}")
    return "\n".join(lines)


def apply(ruleset: str) -> None:
    """Load the ruleset via `nft -f -`. Raises on nft error (caller logs, fails open)."""
    subprocess.run(["nft", "-f", "-"], input=ruleset.encode(), check=True)


def flush() -> None:
    """Remove our table. Fail open: ignore 'No such file' when the table is absent."""
    subprocess.run(["nft", "delete", "table", "inet", TABLE], capture_output=True, check=False)


def enable_forwarding() -> None:
    """Enable IPv4 + IPv6 forwarding so redirected traffic can be routed."""
    for path in (
        "/proc/sys/net/ipv4/ip_forward",
        "/proc/sys/net/ipv6/conf/all/forwarding",
    ):
        try:
            with open(path, "w") as f:
                f.write("1\n")
        except OSError as e:
            log.warning("could not enable forwarding at %s: %s", path, e)


def add_pairs(out: Mapping | Iterable, back: Mapping | Iterable) -> None:
    """Add or refresh homework pairs ({pair: seconds} or bare pairs) in one nft batch.

    `add; delete; add timeout` per element replaces an existing element's timeout
    atomically (a plain add would keep the old, shorter one). Raises on nft failure.
    """
    lines = []
    for name, elems in (
        ("hw_out", _hw_elems(out, out=True)),
        ("hw_back", _hw_elems(back, out=False)),
    ):
        for e in elems:
            key = e.rsplit(" timeout ", 1)[0]
            lines.append(f"add element inet {TABLE} {name} {{ {key} }}")
            lines.append(f"delete element inet {TABLE} {name} {{ {key} }}")
            lines.append(f"add element inet {TABLE} {name} {{ {e} }}")
    if lines:
        subprocess.run(["nft", "-f", "-"], input="\n".join(lines).encode(), check=True)


def _conntrack_delete(*args: str) -> None:
    try:
        subprocess.run(["conntrack", "-D", *args], check=True, capture_output=True)
    except subprocess.CalledProcessError as e:
        if e.returncode != 1:  # 1 = no matching flows
            raise


def kill_conntrack(ips: set[str], device_ip: str | None = None) -> None:
    """Drop a device's tracked flows: to/from `ips` only, or all of them if `ips` is empty.

    Every deletion is scoped to the device so other LAN hosts' flows to a shared remote IP
    survive. Unknown or invalid device IP -> nothing is deleted.
    """
    if not device_ip or not _ip4(device_ip):
        if ips:
            log.warning("homework cut skipped: device IP unknown")
        return
    try:
        if not ips:
            _conntrack_delete("-s", device_ip)
            return
        for ip in sorted(ips):
            if not _ip4(ip):
                log.warning("skipping invalid conntrack IP %r", ip)
                continue
            _conntrack_delete("-s", device_ip, "-d", ip)
            _conntrack_delete("-s", ip, "-d", device_ip)
    except FileNotFoundError:
        log.warning("conntrack binary not found")
