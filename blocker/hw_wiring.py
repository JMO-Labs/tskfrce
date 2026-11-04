"""Homework mode wiring: gate + firewall + DNS + activity reporting."""

from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import datetime

from blocker.homework import HomeworkGate
from blocker.upstream import handle_homework

log = logging.getLogger(__name__)

# (ended MACs, {mac: cut IPs}) -> what the firewall must forget, then conntrack must drop
Plan = tuple[set[str], dict[str, set[str]]]


class HomeworkWiring:
    """Wires homework gate to firewall, DNS, and backend activity reporting.

    Order for every change: gate first (pairs gone), re-render (nft forgets them),
    then the device-scoped conntrack kill, so a cut flow can't be re-admitted.
    """

    def __init__(
        self,
        gate: HomeworkGate,
        fw_module,
        mac_for_ip,
        ip_for_mac,
        cfg,
        gateway_ip: Callable[[], str | None] = lambda: None,
    ):
        self.gate = gate
        self.fw = fw_module
        self.mac_for_ip = mac_for_ip
        self.ip_for_mac = ip_for_mac
        self.cfg = cfg
        self._gateway_ip = gateway_ip

    def sync(self, homework: dict) -> Plan:
        """Push new state into the gate; return what changed (nothing touches nft yet)."""
        ended = self.gate.update(homework)
        cuts = {mac: self.gate.blocked_cut(mac) for mac in self.gate.macs()}
        return ended, {m: c for m, c in cuts.items() if c}

    def expire(self) -> Plan:
        """End sessions past `until` locally (backend may be down)."""
        return self.gate.expire(), {}

    def kill(self, plan: Plan) -> None:
        """Drop tracked flows for ended sessions (whole device) and cut IPs (scoped)."""
        ended, cuts = plan
        for mac in ended:
            self.fw.kill_conntrack(set(), device_ip=self.ip_for_mac(mac))
        for mac, ips in cuts.items():
            self.fw.kill_conntrack(ips, device_ip=self.ip_for_mac(mac))

    def on_state(self, homework: dict, rerender: Callable[[], None] | None = None) -> None:
        """sync -> rerender -> kill. rerender runs even if sync fails (blocks must apply)."""
        plan: Plan = (set(), {})
        try:
            plan = self.sync(homework)
        finally:
            if rerender is not None:
                rerender()
        self.kill(plan)

    def tick(self, rerender: Callable[[], None] | None = None) -> None:
        """Periodic local `until` enforcement."""
        plan = self.expire()
        if plan[0]:
            if rerender is not None:
                rerender()
            self.kill(plan)

    def pairs_for_render(
        self, ip_for_mac: dict[str, str]
    ) -> tuple[dict[tuple[str, str], int], dict[tuple[str, str], int]]:
        """(hw_out, hw_back) as {pair: seconds_left}.

        ip_for_mac is precomputed by the caller (which holds the service lock): calling
        back into the service from here would re-acquire that lock and deadlock.
        """
        hw_out: dict[tuple[str, str], int] = {}
        hw_back: dict[tuple[str, str], int] = {}
        for (mac, ip), secs in self.gate.pairs_ttl().items():
            hw_out[(mac, ip)] = secs
            dev_ip = ip_for_mac.get(mac)
            if dev_ip:
                hw_back[(ip, dev_ip)] = secs
        return hw_out, hw_back

    def claims(self, client_ip: str) -> bool:
        """True if this client's DNS goes through homework (may wait on upstream)."""
        return self.gate.active(self.mac_for_ip(client_ip))

    def dns_handle(self, client_ip: str, query: bytes) -> bytes | None:
        """DNS handler for homework mode."""
        # Configured upstream, else the LAN gateway the box already detected. Never a
        # guessed or public resolver: an empty server makes forward() fail closed.
        server = self.cfg.upstream_dns or self._gateway_ip() or ""
        return handle_homework(
            self.gate, self.fw.add_pairs, self.mac_for_ip, server, client_ip, query
        )

    def flush_activity(self, report):
        """Drain activity and report to backend."""
        activity = self.gate.drain_activity()
        if activity:
            # Format session_start as ISO Z strings
            for item in activity:
                ts = item["session_start"]
                item["session_start"] = (
                    datetime(*ts[:6]).isoformat() + "Z" if isinstance(ts, tuple) else ts
                )
            report(activity)
