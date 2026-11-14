"""Migration 8085632db8db: device_events.detail 120 -> 1000, up and down.

Runs upgrade()/downgrade() in-process so coverage sees the migration lines.
"""

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

PATH = Path(__file__).resolve().parent.parent / "alembic/versions/8085632db8db_event_detail_1000.py"


def _load():
    spec = importlib.util.spec_from_file_location("mig_event_detail", PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture
def conn():
    engine = sa.create_engine("sqlite://")
    with engine.begin() as c:
        c.exec_driver_sql(
            "CREATE TABLE device_events (id INTEGER PRIMARY KEY, detail VARCHAR(120))"
        )
        yield c


def _insert(c, detail):
    c.exec_driver_sql("INSERT INTO device_events (detail) VALUES (?)", (detail,))


def _lengths(c):
    return [len(r[0]) for r in c.exec_driver_sql("SELECT detail FROM device_events ORDER BY id")]


def _type(c):
    rows = c.exec_driver_sql("PRAGMA table_info(device_events)").fetchall()
    return next(r[2] for r in rows if r[1] == "detail")


def test_upgrade_keeps_long_detail_and_downgrade_truncates(conn):
    mod = _load()
    with Operations.context(MigrationContext.configure(conn)):
        mod.upgrade()
        assert _type(conn) == "VARCHAR(1000)"
        _insert(conn, "x" * 500)
        _insert(conn, "short")
        assert _lengths(conn) == [500, 5]
        mod.downgrade()
    assert _type(conn) == "VARCHAR(120)"
    assert _lengths(conn) == [120, 5]
