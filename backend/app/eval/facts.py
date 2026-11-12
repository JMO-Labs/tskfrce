"""Anonymous box facts for the heartbeat: enums and buckets only, "unknown" when missing."""

import os
import platform
import re
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.logging import get_logger
from app.models.network import Network

logger = get_logger(__name__)

KEYS = (
    "ram_class",
    "cpu_cores",
    "arch",
    "net_mode",
    "network_count",
    "update_channel",
    "last_update_result",
    "uptime_bucket",
)
_NET_DAYS = 7
_G = 1024**3
_CHANNELS = frozenset({"stable", "eval", "off"})
_RESULTS = frozenset({"success", "failed"})
_ARCH = {"x86_64": "x86_64", "amd64": "x86_64", "aarch64": "arm64", "arm64": "arm64"}


def ram_class(b: int | None) -> str:
    if not b or b <= 0:
        return "unknown"
    if b <= 2 * _G:
        return "<=2G"
    if b <= 4 * _G:
        return "4G"
    return "8G" if b <= 8 * _G else ">8G"


def uptime_bucket(s: float | None) -> str:
    if s is None or s < 0:
        return "unknown"
    for limit, name in (
        (3600, "<1h"),
        (86400, "1h-1d"),
        (7 * 86400, "1d-7d"),
        (30 * 86400, "7d-30d"),
    ):
        if s < limit:
            return name
    return ">30d"


def cores(n: int | None) -> int:
    return min(n, 64) if n and n > 0 else 0


def arch(m: str | None) -> str:
    if not m:
        return "unknown"
    m = m.lower()
    if m in _ARCH:
        return _ARCH[m]
    return "arm" if re.fullmatch(r"armv\d.*", m) else "other"


def net(db: Session, status: dict | None) -> tuple[str, int]:
    """(net_mode, network_count) from recent multinet rows, else netd; no names leave."""
    since = datetime.utcnow() - timedelta(days=_NET_DAYS)
    ifaces = db.scalars(select(Network.iface).where(Network.last_seen >= since)).all()
    if ifaces:
        wifi = any(i.startswith("wl") for i in ifaces)
        wired = any(not i.startswith("wl") for i in ifaces)
        return ("both" if wifi and wired else "wifi" if wifi else "wired"), len(ifaces)
    if not status:
        return "unknown", 0
    if status.get("connected"):
        return "wifi", 1
    return ("wired", 1) if status.get("online") else ("unknown", 0)


def update() -> tuple[str, str]:
    try:
        from app.api import updates

        st = updates._read_state()
        ch, res = st.get("channel"), st.get("last_result")
    except Exception as e:
        logger.warning("eval_facts_update_failed", error=type(e).__name__)
        return "unknown", "unknown"
    return (ch if ch in _CHANNELS else "unknown", res if res in _RESULTS else "unknown")


def _ram_bytes() -> int | None:
    try:
        return os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES")
    except (ValueError, OSError, AttributeError):
        return None


def _uptime() -> float | None:
    try:
        with open("/proc/uptime") as f:
            return float(f.read().split()[0])
    except (OSError, ValueError, IndexError):
        return None


def _netd() -> dict | None:
    try:
        from app.services import network_wifi

        return network_wifi.status()
    except Exception:  # daemon absent (dev, CI, wired-only boxes)
        return None


def collect(db: Session) -> dict:
    mode, count = net(db, _netd())
    channel, result = update()
    return {
        "ram_class": ram_class(_ram_bytes()),
        "cpu_cores": cores(os.cpu_count()),
        "arch": arch(platform.machine()),
        "net_mode": mode,
        "network_count": count,
        "update_channel": channel,
        "last_update_result": result,
        "uptime_bucket": uptime_bucket(_uptime()),
    }
