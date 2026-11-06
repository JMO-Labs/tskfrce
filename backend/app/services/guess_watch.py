"""Tell parents when someone keeps getting a parent password wrong."""

import time
from collections import deque
from threading import Lock

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.models.user import User, UserRole
from app.services import inbox

THRESHOLD = 5
WINDOW = 900
COOLDOWN = 3600

# ponytail: single uvicorn process; resets on restart
_fails: dict[int, deque[float]] = {}
_alerted: dict[int, float] = {}
_lock = Lock()


def reset() -> None:
    with _lock:
        _fails.clear()
        _alerted.clear()


def record_failure(db: Session, login: str, now: float | None = None) -> None:
    """Count a failed login against an existing, active parent; alert on a burst.

    Never stores or sends the typed login or password.
    """
    now = time.monotonic() if now is None else now
    key = login.lower()
    user = (
        db.query(User)
        .filter(or_(func.lower(User.username) == key, func.lower(User.email) == key))
        .first()
    )
    if not user or not user.is_active or user.role == UserRole.KID:
        return
    with _lock:
        hits = _fails.setdefault(user.id, deque())
        hits.append(now)
        while hits and hits[0] <= now - WINDOW:
            hits.popleft()
        last = _alerted.get(user.id)
        if len(hits) < THRESHOLD or (last is not None and now - last < COOLDOWN):
            return
        _alerted[user.id] = now
        hits.clear()
    name = user.full_name or user.username
    inbox.notify_parents(
        db,
        "password_guess",
        f"Someone is guessing {name}'s password",
        "5 wrong passwords in 15 minutes. If it wasn't you, change it in Settings.",
    )
    db.commit()
