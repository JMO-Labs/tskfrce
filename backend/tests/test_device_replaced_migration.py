"""Migration r1e2l3i4n5k6: devices.replaced column up and down."""

import os
import sqlite3
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
PREV = "0b953fcb092f"
NEW = "r1e2l3i4n5k6"


def alembic(url, *args):
    subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=BACKEND,
        env={**os.environ, "DATABASE_URL": url},
        check=True,
    )


def _cols(path):
    con = sqlite3.connect(path)
    try:
        return {r[1]: r for r in con.execute("PRAGMA table_info(devices)")}
    finally:
        con.close()


def test_upgrade_adds_and_downgrade_drops_replaced(tmp_path):
    path = tmp_path / "mig.db"
    url = f"sqlite:///{path}"
    alembic(url, "upgrade", PREV)
    assert "replaced" not in _cols(path)
    alembic(url, "upgrade", NEW)
    col = _cols(path)["replaced"]
    assert col[3] == 1  # NOT NULL
    assert col[4] in ("0", "'0'")  # server default false
    alembic(url, "downgrade", PREV)
    assert "replaced" not in _cols(path)
