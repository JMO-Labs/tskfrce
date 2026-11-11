"""Which host interfaces are real home networks (spec A2), and per-address portal binding (A3).

A network counts when it's physical Ethernet, Wi-Fi or a VLAN with a private IPv4 address.
Docker bridges, veths, loopback, VPNs, the setup hotspot, link-local and CGNAT never count.
"""

import ipaddress
import json
import logging
import subprocess
import threading
from collections.abc import Callable
from pathlib import Path

log = logging.getLogger(__name__)

SKIP_PREFIXES = ("lo", "docker", "br-", "veth", "virbr", "wg", "tailscale", "tun", "tap", "zt")
PRIVATE = [ipaddress.ip_network(n) for n in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")]
EXCLUDE = [ipaddress.ip_network(n) for n in ("10.42.0.0/24", "169.254.0.0/16", "100.64.0.0/10")]
SYS = Path("/sys/class/net")
LAN_KINDS = {"vlan", "bridge", "bond", "macvlan"}


def is_lan_ip(ip: str) -> bool:
    a = ipaddress.ip_address(ip)
    return any(a in n for n in PRIVATE) and not any(a in n for n in EXCLUDE)


def is_lan_link(name: str, kind: str | None, sys: Path = SYS) -> bool:
    if name.startswith(SKIP_PREFIXES):
        return False
    # Physical NICs and Wi-Fi have a device/ link; VLANs, bridges (br0 on Unraid/Proxmox),
    # bonds and macvlans don't. Docker's own bridges are already excluded by name above.
    return kind in LAN_KINDS or (sys / name / "device").exists()


def parse(ip_json: str, sys: Path = SYS) -> list[tuple[str, str]]:
    """(iface, ipv4) pairs from `ip -j -d -4 addr show up` output."""
    out = []
    for link in json.loads(ip_json or "[]"):
        name = link.get("ifname", "")
        kind = (link.get("linkinfo") or {}).get("info_kind")
        if not is_lan_link(name, kind, sys):
            continue
        for a in link.get("addr_info", []):
            if a.get("family") == "inet" and is_lan_ip(a["local"]):
                out.append((name, a["local"]))
    return out


def lan_addrs() -> list[tuple[str, str]]:
    try:
        r = subprocess.run(
            ["ip", "-j", "-d", "-4", "addr", "show", "up"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,  # a failure just means no interfaces this round
        )
        return parse(r.stdout)
    except (OSError, ValueError, subprocess.SubprocessError):
        log.exception("listing interfaces failed")
        return []


class PerAddress:
    """Keep one server per LAN address: start for new addresses, stop for gone ones.

    serve(ip, stop_event) must block until stop_event is set. Re-checked every `every` seconds.
    # ponytail: 30 s polling, not netlink; a DHCP change takes up to 30 s to follow
    """

    def __init__(
        self,
        serve: Callable[[str, threading.Event], None],
        every: float = 30,
        addrs: Callable[[], list[tuple[str, str]]] = lan_addrs,
    ):
        self.serve, self.every, self.addrs = serve, every, addrs
        self.running: dict[str, threading.Event] = {}

    def sync(self) -> None:
        want = {ip for _, ip in self.addrs()}
        for ip in set(self.running) - want:
            self.running.pop(ip).set()
        for ip in want - set(self.running):
            ev = self.running[ip] = threading.Event()
            threading.Thread(target=self._run, args=(ip, ev), daemon=True).start()

    def _run(self, ip: str, ev: threading.Event) -> None:
        try:
            self.serve(ip, ev)
        except Exception:
            log.exception("portal on %s failed; retrying next sync", ip)
        if self.running.get(ip) is ev:  # ended without being told to: let the next sync restart it
            del self.running[ip]

    def run(self, stop: threading.Event) -> None:
        while not stop.is_set():
            self.sync()
            stop.wait(self.every)
        for ev in self.running.values():
            ev.set()
