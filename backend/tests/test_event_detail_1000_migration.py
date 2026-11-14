"""Migration 8085632db8db: device_events.detail 120 -> 1000, up and down."""

import os
import sqlite3
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
PREV = "7b2e4c1a9f30"
NEW = "8085632db8db"


def alembic(url, *args):
    subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=BACKEND,
        env={**os.environ, "DATABASE_URL": url},
        check=True,
    )


def _insert(path, detail):
    con = sqlite3.connect(path)
    try:
        con.execute(
            "INSERT INTO device_events (device_id, kind, at, count, detail) "
            "VALUES (1, 'bypass', '2026-01-01 00:00:00', 1, ?)",
            (detail,),
        )
        con.commit()
    finally:
        con.close()


def _details(path):
    con = sqlite3.connect(path)
    try:
        return [r[0] for r in con.execute("SELECT detail FROM device_events ORDER BY id")]
    finally:
        con.close()


def test_upgrade_keeps_long_detail_and_downgrade_truncates(tmp_path):
    path = tmp_path / "mig.db"
    url = f"sqlite:///{path}"
    alembic(url, "upgrade", PREV)
    alembic(url, "upgrade", NEW)
    _insert(path, "x" * 500)
    _insert(path, "short")
    assert [len(d) for d in _details(path)] == [500, 5]
    alembic(url, "downgrade", PREV)
    assert [len(d) for d in _details(path)] == [120, 5]
