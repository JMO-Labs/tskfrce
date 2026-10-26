"""Eval hooks called from existing code. Never raise into callers."""

import functools
from datetime import UTC, datetime

from app.core.logging import get_logger
from app.eval import store
from app.eval.config import stats_on

logger = get_logger(__name__)


def safe(fn):
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except Exception as exc:
            logger.warning("Eval hook failed", hook=fn.__name__, error=str(exc))
            return None

    return wrapper


@safe
def seen(user) -> None:
    if not stats_on():
        return
    from app.models.user import UserRole

    store.mark_seen("parent" if user.role == UserRole.PARENT else f"kid:{user.id}")


@safe
def after_tick(db) -> None:
    if not stats_on():
        return
    from app.eval import locks
    from app.models.family import get_family

    store.set_tz(get_family(db).timezone)
    locks.track(db, datetime.now(UTC))


@safe
def start(app) -> None:
    import asyncio

    from app.eval import listeners, worker
    from app.eval.config import any_on
    from app.eval.events import emit

    if not any_on():
        return
    listeners.register()
    if stats_on():
        emit("box_boot")
    app.state.eval_task = asyncio.create_task(worker.run_forever())


@safe
def stop(app) -> None:
    task = getattr(app.state, "eval_task", None)
    if task:
        task.cancel()
