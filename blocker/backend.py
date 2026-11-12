"""HTTP client for the backend's internal device-report and state endpoints."""

from __future__ import annotations

import json
import logging
import urllib.request
from dataclasses import asdict, dataclass

from blocker.config import Config

log = logging.getLogger(__name__)

TIMEOUT = 5
_BASE = "/api/v1/internal"


@dataclass
class Seen:
    mac: str
    ip: str | None
    ipv6: list[str]
    hostname: str | None
    vendor: str | None
    mdns_name: str | None = None
    model: str | None = None
    dhcp_fp: str | None = None
    vid: int | None = None  # tagged VLAN; None = the untagged LAN
    iface: str | None = None  # base interface name (eno2, wlo1, etc.); None when using LAN_IFACE
    gateway_mac: str | None = None  # blocker's gateway MAC for filtering
    box_mac: str | None = None  # blocker's own MAC for filtering

    def __post_init__(self) -> None:
        for f in ("mdns_name", "model", "dhcp_fp"):
            v = getattr(self, f)
            if v is not None:
                setattr(self, f, v[:255])

    def body(self) -> dict:
        return {k: v for k, v in asdict(self).items() if v is not None or k not in _OPTIONAL}


_OPTIONAL = ("mdns_name", "model", "dhcp_fp", "vid", "iface", "gateway_mac", "box_mac")


def _request(cfg: Config, path: str, body: dict | None = None, base: str = _BASE):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"X-Internal-Token": cfg.internal_token}
    if data is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(
        cfg.backend_url.rstrip("/") + base + path,
        data=data,
        headers=headers,
        method="POST" if data is not None else "GET",
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        return json.loads(resp.read())


def report_seen(cfg: Config, seen: Seen) -> int | None:
    try:
        return int(_request(cfg, "/devices/seen", seen.body())["id"])
    except Exception as e:  # noqa: BLE001 - best effort, the daemon keeps running
        log.warning("report_seen failed for %s: %s", seen.mac, e)
        return None


def fetch_blocked(cfg: Config) -> list[str] | None:
    try:
        return [str(m) for m in _request(cfg, "/state")["blocked"]]
    except Exception as e:  # noqa: BLE001 - best effort, the daemon keeps running
        log.warning("fetch_blocked failed: %s", e)
        return None


def fetch_state(cfg: Config) -> dict | None:
    """{"blocked": [...], "homework": {...}, "listen_only": bool, "covered_vlans": [int], "network_enforce": {iface:subnet: bool}}; None if unreachable."""
    try:
        raw = _request(cfg, "/state")
        return {
            "blocked": [str(m) for m in raw["blocked"]],
            "homework": raw.get("homework", {}),
            "listen_only": bool(raw.get("listen_only", False)),
            "covered_vlans": [int(v) for v in raw.get("covered_vlans", [])],
            "network_enforce": raw.get("network_enforce", {}),
        }
    except Exception as e:  # noqa: BLE001 - best effort, the daemon keeps running
        log.warning("fetch_state failed: %s", e)
        return None


def report_resisting(cfg: Config, macs: set[str]) -> bool:
    try:
        _request(cfg, "/devices/resisting", {"resisting": sorted(macs)})
        return True
    except Exception as e:  # noqa: BLE001 - best effort, the daemon keeps running
        log.warning("report_resisting failed: %s", e)
        return False


def report_vlans(cfg: Config, vlans: list[dict]) -> bool:
    try:
        _request(cfg, "/vlans", {"vlans": vlans})
        return True
    except Exception as e:  # noqa: BLE001 - best effort, the daemon keeps running
        log.warning("report_vlans failed: %s", e)
        return False


def report_workarounds(cfg: Config, found: dict[str, list[str]]) -> bool:
    try:
        _request(cfg, "/devices/workarounds", {"found": found})
        return True
    except Exception as e:  # noqa: BLE001 - best effort, the daemon keeps running
        log.warning("report_workarounds failed: %s", e)
        return False


def report_hits(cfg: Config, hits: dict[str, int]) -> bool:
    try:
        _request(cfg, "/devices/hits", {"hits": hits})
        return True
    except Exception as e:  # noqa: BLE001 - best effort, the daemon keeps running
        log.warning("report_hits failed: %s", e)
        return False


def report_homework_activity(cfg: Config, items: list[dict]) -> bool:
    """Report homework activity batches (in chunks of <= 500)."""
    if not items:
        return True
    try:
        for i in range(0, len(items), 500):
            chunk = items[i : i + 500]
            _request(cfg, "/homework/activity", {"items": chunk})
        return True
    except Exception as e:  # noqa: BLE001 - best effort, the daemon keeps running
        log.warning("report_homework_activity failed: %s", e)
        return False


def report_networks(cfg: Config, networks: list[dict]) -> bool:
    """Report detected networks (interfaces, subnets, labels)."""
    try:
        _request(cfg, "/networks", {"networks": networks})
        return True
    except Exception as e:  # noqa: BLE001 - best effort, the daemon keeps running
        log.warning("report_networks failed: %s", e)
        return False


def report_fault(cfg: Config, kind: str) -> bool:
    """Anonymous eval telemetry (enum only). Best effort: never raises, never blocks startup long."""
    try:
        _request(cfg, "/fault", {"component": "blocker", "kind": kind}, base="/internal/eval")
        return True
    except Exception as e:  # noqa: BLE001 - best effort
        log.warning("report_fault failed: %s", e)
        return False
