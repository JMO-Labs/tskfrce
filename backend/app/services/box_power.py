"""Power-outage detection: a last-alive heartbeat plus a clean-shutdown marker in DATA_DIR.

Boot with a heartbeat but no marker = the box lost power; the outage is last-alive -> boot.
"""

import asyncio
import json
import os
from datetime import datetime, timedelta
from pathlib import Path

from app.core.config import settings

BEAT_SECONDS = 60
KEEP_DAYS = 90
ISO = "%Y-%m-%dT%H:%M:%S"


def data_dir() -> Path:
    return Path(os.environ.get("DATA_DIR") or settings.DATA_DIR)


def _alive() -> Path:
    return data_dir() / "last-alive"


def _clean() -> Path:
    return data_dir() / "clean-shutdown"


def heartbeat(now: datetime | None = None) -> None:
    _alive().write_text((now or datetime.utcnow()).replace(microsecond=0).strftime(ISO))
    _clean().unlink(missing_ok=True)


def mark_clean_shutdown() -> None:
    _clean().write_text("1")


def outages() -> list[dict]:
    """Recorded outages (naive UTC ISO strings), oldest first."""
    try:
        data = json.loads((data_dir() / "outages.json").read_text())
    except (OSError, ValueError):
        return []
    return [o for o in data if isinstance(o, dict) and "start" in o and "end" in o]


def check_boot(now: datetime | None = None) -> dict | None:
    """Call once at startup. Records and returns the outage if the last stop was unclean."""
    now = (now or datetime.utcnow()).replace(microsecond=0)
    try:
        last = datetime.strptime(_alive().read_text().strip(), ISO)
    except (OSError, ValueError):
        return None  # first boot, or nothing readable: nothing to claim
    unclean = not _clean().exists()
    _clean().unlink(missing_ok=True)  # re-arm: a crash from here on must read as unclean
    if not unclean:
        return None
    out = {"start": last.strftime(ISO), "end": now.strftime(ISO)}
    cutoff = (now - timedelta(days=KEEP_DAYS)).strftime(ISO)
    kept = [o for o in outages() if o["end"] >= cutoff] + [out]
    (data_dir() / "outages.json").write_text(json.dumps(kept))
    return out


async def run_forever() -> None:
    while True:
        try:
            heartbeat()
        except OSError:
            pass  # a full disk must not kill the loop; the storage warning covers it
        await asyncio.sleep(BEAT_SECONDS)
