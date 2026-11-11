"""Push the blocked-MAC list and homework map to the network blocker service."""

import httpx

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


def push_state(blocked: list[str], homework: dict) -> bool:
    """Push blocked MACs and the homework map. Never raises; False means the blocker was not updated."""
    try:
        r = httpx.post(
            f"{settings.BLOCKER_URL}/state",
            json={"blocked": blocked, "homework": homework},
            headers={"X-Internal-Token": settings.INTERNAL_TOKEN or ""},
            timeout=5,
        )
        r.raise_for_status()
        return True
    except Exception as exc:
        logger.warning("Blocker push_state failed", error=str(exc))
        return False


def test_block(mac: str) -> dict | None:
    """Ask the blocker to diagnose one device. None if the blocker did not answer."""
    try:
        r = httpx.post(
            f"{settings.BLOCKER_URL}/test-block",
            json={"mac": mac},
            headers={"X-Internal-Token": settings.INTERNAL_TOKEN or ""},
            timeout=20,
        )
        r.raise_for_status()
        return r.json()
    except Exception as exc:
        logger.warning("Blocker test-block failed", error=str(exc))
        return None
