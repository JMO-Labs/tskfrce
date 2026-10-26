"""Background loop: daily heartbeat, then outbox flush."""

import asyncio
from datetime import UTC, datetime

from app.core.logging import get_logger
from app.eval import heartbeat, sender, store
from app.eval.config import stats_on

logger = get_logger(__name__)


def cycle() -> None:
    try:
        from app.core.database import SessionLocal
        from app.models.family import get_family

        db = SessionLocal()
        try:
            store.set_tz(get_family(db).timezone)
            if stats_on():
                heartbeat.maybe_send(db, datetime.now(UTC))
        finally:
            db.close()
    except Exception as exc:
        logger.warning("Eval heartbeat failed", error=str(exc))
    try:
        sender.flush()
    except Exception as exc:
        logger.warning("Eval flush failed", error=str(exc))


async def run_forever(interval: int = 30) -> None:
    while True:
        await asyncio.to_thread(cycle)
        await asyncio.sleep(interval)
