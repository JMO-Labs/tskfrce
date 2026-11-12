"""Anonymous box facts for the heartbeat: enums and buckets only, "unknown" when missing."""

import os
import platform
import re

from app.core.logging import get_logger

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


def net(status: dict | None) -> tuple[str, int]:
    """(net_mode, network_count) from the netd status; no names ever leave this function."""
    if not status:
        return "unknown", 0
    wifi = bool(status.get("connected"))
    wired = status.get("wired")
    if wired is None:  # netd does not report wired: online without Wi-Fi means cable
        wired = bool(status.get("online")) and not wifi
    if wifi and wired:
        return "both", 2
    if wifi:
        return "wifi", 1
    if wired:
        return "wired", 1
    return "unknown", 0


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


def collect() -> dict:
    mode, count = net(_netd())
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
