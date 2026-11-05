"""Integrations background loop: runs each step on a fixed tick. Never crashes the app."""

import asyncio
from collections.abc import Callable
from datetime import UTC, datetime

from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.core.logging import get_logger
from app.integrations import catalog

logger = get_logger(__name__)
TICK_SECONDS = 15
STEPS: list[Callable[[Session, datetime], None]] = [catalog.sync_step]


def _run_once(now: datetime) -> None:
    db = SessionLocal()
    try:
        for step in list(STEPS):
            name = getattr(step, "__name__", "step")
            try:
                step(db, now)
            except OperationalError as exc:
                db.rollback()
                if "database is locked" in str(exc):
                    logger.warning("Integrations step skipped: database busy", step=name)
                else:
                    logger.error("Integrations step failed", step=name, error=str(exc))
            except Exception as exc:
                db.rollback()
                logger.error("Integrations step failed", step=name, error=str(exc))
    finally:
        db.close()


async def run_forever() -> None:
    while True:
        try:
            now = datetime.now(UTC).replace(tzinfo=None)
            await asyncio.to_thread(_run_once, now)
        except Exception as exc:  # e.g. SessionLocal() itself failed
            logger.error("Integrations tick failed", error=str(exc))
        await asyncio.sleep(TICK_SECONDS)
