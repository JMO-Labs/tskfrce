"""eval.db: household id, counters, seen set and the send outbox."""

import json
import sqlite3
import time
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import NamedTuple
from zoneinfo import ZoneInfo

from app.core.config import settings

_SCHEMA = """
CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS counters(day TEXT, name TEXT, value INTEGER NOT NULL,
  PRIMARY KEY(day, name));
CREATE TABLE IF NOT EXISTS seen(day TEXT, who TEXT, PRIMARY KEY(day, who));
CREATE TABLE IF NOT EXISTS kid_ages(kid_id INTEGER PRIMARY KEY, age_group TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS outbox(id INTEGER PRIMARY KEY, kind TEXT NOT NULL,
  body TEXT NOT NULL, created_at REAL NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
  next_at REAL NOT NULL);
"""

_tz: ZoneInfo | None = None
_seen: set[tuple[str, str]] = set()


class OutRow(NamedTuple):
    id: int
    kind: str
    body: dict
    created_at: float
    attempts: int


def db_path() -> Path:
    return Path(settings.DATA_DIR) / "eval.db"


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(db_path(), timeout=5, isolation_level=None)
    c.executescript(_SCHEMA)
    return c


def _run(sql: str, args: tuple = ()) -> list[tuple]:
    c = _conn()
    try:
        return c.execute(sql, args).fetchall()
    finally:
        c.close()


def kv_get(key: str) -> str | None:
    rows = _run("SELECT value FROM kv WHERE key=?", (key,))
    return rows[0][0] if rows else None


def kv_set(key: str, value: str) -> None:
    _run("INSERT OR REPLACE INTO kv(key, value) VALUES(?, ?)", (key, value))


def once(key: str) -> bool:
    c = _conn()
    try:
        cur = c.execute("INSERT OR IGNORE INTO kv(key, value) VALUES(?, '1')", (f"once:{key}",))
        return cur.rowcount == 1
    finally:
        c.close()


def household() -> str:
    c = _conn()
    try:
        c.execute(
            "INSERT OR IGNORE INTO kv(key, value) VALUES('household', ?)", (str(uuid.uuid4()),)
        )
        return c.execute("SELECT value FROM kv WHERE key='household'").fetchone()[0]
    finally:
        c.close()


def set_tz(name: str) -> None:
    global _tz
    try:
        _tz = ZoneInfo(name)
    except Exception:
        _tz = ZoneInfo("UTC")


def local_day(now_utc: datetime | None = None, days_back: int = 0) -> str:
    now = now_utc or datetime.now(UTC)
    d = now.astimezone(_tz or ZoneInfo("UTC")).date()
    return (d - timedelta(days=days_back)).isoformat()


def bump(name: str, n: int = 1, day: str | None = None) -> None:
    _run(
        "INSERT INTO counters(day, name, value) VALUES(?, ?, ?) "
        "ON CONFLICT(day, name) DO UPDATE SET value = value + excluded.value",
        (day or local_day(), name, n),
    )


def counters(day: str) -> dict[str, int]:
    return dict(_run("SELECT name, value FROM counters WHERE day=?", (day,)))


def mark_seen(who: str, day: str | None = None) -> None:
    key = (day or local_day(), who)
    if key in _seen:
        return
    _run("INSERT OR IGNORE INTO seen(day, who) VALUES(?, ?)", key)
    _seen.add(key)


def seen_counts(day: str) -> tuple[int, int]:
    whos = [r[0] for r in _run("SELECT who FROM seen WHERE day=?", (day,))]
    return int("parent" in whos), sum(w.startswith("kid:") for w in whos)


def set_kid_age(kid_id: int, group: str) -> None:
    _run("INSERT OR REPLACE INTO kid_ages(kid_id, age_group) VALUES(?, ?)", (kid_id, group))


def kid_age(kid_id: int | None) -> str:
    if kid_id is None:
        return "unknown"
    rows = _run("SELECT age_group FROM kid_ages WHERE kid_id=?", (kid_id,))
    return rows[0][0] if rows else "unknown"


DAILY_CAP = 500  # umami events per box per local day


def _apply_cap(kind: str) -> None:
    """Count today's umami enqueues; at the cap drop the oldest pending one, count `dropped`."""
    if kind != "umami":
        return
    day = local_day()
    if counters(day).get("enq", 0) < DAILY_CAP:
        bump("enq", day=day)
        return
    bump("dropped", day=day)
    _run(
        "DELETE FROM outbox WHERE id=(SELECT id FROM outbox WHERE kind='umami' "
        "ORDER BY created_at, id LIMIT 1)"
    )


def enqueue(kind: str, body: dict, now: float | None = None) -> None:
    _apply_cap(kind)
    t = time.time() if now is None else now
    _run(
        "INSERT INTO outbox(kind, body, created_at, next_at) VALUES(?, ?, ?, ?)",
        (kind, json.dumps(body), t, t),
    )


def due(now: float, limit: int = 20) -> list[OutRow]:
    rows = _run(
        "SELECT id, kind, body, created_at, attempts FROM outbox "
        "WHERE next_at <= ? ORDER BY created_at, id LIMIT ?",
        (now, limit),
    )
    return [OutRow(i, k, json.loads(b), c, a) for i, k, b, c, a in rows]


def sent(row_id: int) -> None:
    _run("DELETE FROM outbox WHERE id=?", (row_id,))


def failed(row_id: int, attempts: int, now: float) -> None:
    _run(
        "UPDATE outbox SET attempts=?, next_at=? WHERE id=?",
        (attempts, now + min(60 * 2**attempts, 3600), row_id),
    )


def prune(now: float) -> int:
    c = _conn()
    try:
        return c.execute(
            "DELETE FROM outbox WHERE kind='umami' AND created_at < ?", (now - 14 * 86400,)
        ).rowcount
    finally:
        c.close()


def _reset() -> None:
    global _tz
    _tz = None
    _seen.clear()
