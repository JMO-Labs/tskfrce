"""Migration f1n2g3e4r5b6: devices.device_class / device_class_score, up and down.

Runs upgrade()/downgrade() in-process so coverage sees the migration lines.
"""

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

PATH = Path(__file__).resolve().parent.parent / "alembic/versions/f1n2g3e4r5b6_device_class.py"


def _load():
    spec = importlib.util.spec_from_file_location("mig_device_class", PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture
def conn():
    engine = sa.create_engine("sqlite://")
    with engine.begin() as c:
        c.exec_driver_sql("CREATE TABLE devices (id INTEGER PRIMARY KEY, name VARCHAR(50))")
        c.exec_driver_sql("INSERT INTO devices (name) VALUES ('laptop')")
        yield c


def _cols(c):
    rows = c.exec_driver_sql("PRAGMA table_info(devices)").fetchall()
    return {r[1]: r[2] for r in rows}


def test_upgrade_adds_columns_and_downgrade_removes_them(conn):
    mod = _load()
    with Operations.context(MigrationContext.configure(conn)):
        mod.upgrade()
        cols = _cols(conn)
        assert cols["device_class"] == "VARCHAR(255)"
        assert cols["device_class_score"] == "INTEGER"
        row = conn.exec_driver_sql("SELECT device_class, device_class_score FROM devices").one()
        assert tuple(row) == (None, None)
        mod.downgrade()
    assert set(_cols(conn)) == {"id", "name"}
    assert conn.exec_driver_sql("SELECT name FROM devices").scalar() == "laptop"
