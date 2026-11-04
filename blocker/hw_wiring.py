"""Homework mode wiring: gate + firewall + DNS + activity reporting."""

from __future__ import annotations

import logging
from datetime import datetime

from blocker.homework import HomeworkGate
from blocker.upstream import handle_homework

log = logging.getLogger(__name__)


class HomeworkWiring:
    """Wires homework gate to firewall, DNS, and backend activity reporting."""

    def __init__(self, gate: HomeworkGate, fw_module, mac_for_ip, ip_for_mac, cfg):
        self.gate = gate
        self.fw = fw_module
        self.mac_for_ip = mac_for_ip
        self.ip_for_mac = ip_for_mac
        self.cfg = cfg

    def on_state(self, homework: dict) -> None:
        """Update gate with new homework state; kill conntrack for ended sessions and block changes."""
        ended = self.gate.update(homework)

        # Kill conntrack for ended MACs
        for mac in ended:
            dev_ip = self.ip_for_mac(mac)
            self.fw.kill_conntrack(set(), device_ip=dev_ip)

        # Handle block-list changes: find cut IPs and kill their connections
        for mac in self.gate._sessions:
            cut = self.gate.blocked_cut(mac)
            if cut:
                dev_ip = self.ip_for_mac(mac)
                self.fw.kill_conntrack(cut, device_ip=dev_ip)

    def pairs_for_render(self) -> tuple[set[tuple[str, str]], set[tuple[str, str]]]:
        """Return (hw_out, hw_back) pairs for firewall render."""
        hw_out = set()
        hw_back = set()
        for mac, ip in self.gate.pairs():
            hw_out.add((mac, ip))
            dev_ip = self.ip_for_mac(mac)
            if dev_ip:
                hw_back.add((ip, dev_ip))
        return hw_out, hw_back

    def dns_handle(self, client_ip: str, query: bytes) -> bytes | None:
        """DNS handler for homework mode."""
        server = self.cfg.upstream_dns or _gateway_ip()
        return handle_homework(self.gate, self.fw.add_pairs, self.mac_for_ip, server, client_ip, query)

    def flush_activity(self, report):
        """Drain activity and report to backend."""
        activity = self.gate.drain_activity()
        if activity:
            # Format session_start as ISO Z strings
            for item in activity:
                ts = item["session_start"]
                item["session_start"] = datetime(*ts[:6]).isoformat() + "Z" if isinstance(ts, tuple) else ts
            report(activity)


def _gateway_ip() -> str:
    """Try to detect the LAN gateway IP from the system."""
    try:
        import socket
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        # Replace last octet with 1 (typical gateway)
        parts = ip.split(".")
        if len(parts) == 4:
            parts[-1] = "1"
            return ".".join(parts)
    except Exception:
        pass
    return ""
