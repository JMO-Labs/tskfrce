"""Migration o2b3c4d5e6f7: kid enrollment tables, alert_topic, wizard step shift."""

import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parent.parent
PREV = "b0c1d2e3f4a5"
NEW = "o2b3c4d5e6f7"


def alembic(url, *args):
    subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=BACKEND,
        env={**os.environ, "DATABASE_URL": url},
        check=True,
    )


@pytest.fixture
def db(tmp_path):
    path = tmp_path / "mig.db"
    url = f"sqlite:///{path}"
    alembic(url, "upgrade", PREV)
    return path, url


def _steps(path):
    con = sqlite3.connect(path)
    rows = con.execute("SELECT id, setup_step FROM family_settings ORDER BY id").fetchall()
    con.close()
    return [r[1] for r in rows]


def _seed(path):
    """Raw inserts at the old schema (only the NOT NULL columns without defaults)."""
    con = sqlite3.connect(path)
    con.execute("DELETE FROM family_settings")
    cols = [r for r in con.execute("PRAGMA table_info(family_settings)") if r[3] and r[4] is None]
    names = [r[1] for r in cols if r[1] not in ("id", "setup_step")]
    for i, step in enumerate((4, 3, None, 7), start=1):
        vals = [
            f"x{i}" if n == "name" else "UTC" if n == "timezone" else "00:00" if "time" in n else 0
            for n in names
        ]
        con.execute(
            f"INSERT INTO family_settings (id, setup_step, {', '.join(names)}) "
            f"VALUES (?, ?, {', '.join('?' * len(names))})",
            (i, step, *vals),
        )
    con.commit()
    con.close()


def test_tables_created(db):
    path, url = db
    alembic(url, "upgrade", "head")
    con = sqlite3.connect(path)
    tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"kid_enroll_tokens", "kid_devices"} <= tables

    def unique_cols(table):
        out = set()
        for _, name, unique, *_ in con.execute(f"PRAGMA index_list({table})"):
            if unique:
                out |= {r[2] for r in con.execute(f"PRAGMA index_info({name})")}
        return out

    assert "token_hash" in unique_cols("kid_enroll_tokens")
    assert "secret_hash" in unique_cols("kid_devices")
    assert "alert_topic" in unique_cols("users")
    assert "alert_topic" in {r[1] for r in con.execute("PRAGMA table_info(users)")}
    con.close()


def test_setup_step_shifts_past_new_step(db):
    path, url = db
    _seed(path)
    alembic(url, "upgrade", NEW)
    assert _steps(path) == [5, 3, None, 8]


def test_downgrade_round_trip(db):
    path, url = db
    _seed(path)
    alembic(url, "upgrade", NEW)
    alembic(url, "downgrade", PREV)
    assert _steps(path) == [4, 3, None, 7]
    con = sqlite3.connect(path)
    tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert not tables & {"kid_enroll_tokens", "kid_devices"}
    assert "alert_topic" not in {r[1] for r in con.execute("PRAGMA table_info(users)")}
    con.close()
    alembic(url, "upgrade", NEW)
    assert _steps(path) == [5, 3, None, 8]


def test_cascade_and_indexes(db):
    path, url = db
    alembic(url, "upgrade", "head")
    con = sqlite3.connect(path)
    for t in ("kid_enroll_tokens", "kid_devices"):
        fks = {r[3]: r[6] for r in con.execute(f"PRAGMA foreign_key_list({t})")}
        assert fks["kid_id"] == "CASCADE"
        assert any(
            [c[2] for c in con.execute(f"PRAGMA index_info({i[1]})")] == ["kid_id"]
            for i in con.execute(f"PRAGMA index_list({t})")
        )
    fk = {r[3]: r[6] for r in con.execute("PRAGMA foreign_key_list(kid_enroll_tokens)")}
    assert fk["created_by_id"] == "SET NULL"
    con.close()
