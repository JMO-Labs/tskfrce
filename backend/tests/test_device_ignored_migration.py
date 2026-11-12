"""Migration e7f8a9b0c1d2: devices.status accepts 'ignored'; downgrade folds it back.

Runs upgrade()/downgrade() in-process so coverage sees the migration lines.
"""

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

PATH = Path(__file__).resolve().parent.parent / "alembic/versions/e7f8a9b0c1d2_device_ignored.py"


def _load():
    spec = importlib.util.spec_from_file_location("mig_ignored", PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture
def conn():
    engine = sa.create_engine("sqlite://")
    with engine.begin() as c:
        c.exec_driver_sql(
            "CREATE TABLE devices (id INTEGER PRIMARY KEY, status VARCHAR(16) NOT NULL,"
            " CONSTRAINT ck_device_status CHECK (status IN ('unassigned','assigned','guest')))"
        )
        yield c


def _insert(c, status):
    c.exec_driver_sql("INSERT INTO devices (status) VALUES (?)", (status,))


def test_upgrade_allows_ignored_and_downgrade_reverts(conn):
    mod = _load()
    with Operations.context(MigrationContext.configure(conn)):
        with pytest.raises(sa.exc.IntegrityError):
            _insert(conn, "ignored")
        mod.upgrade()
        _insert(conn, "ignored")
        mod.downgrade()
    rows = conn.exec_driver_sql("SELECT status FROM devices").fetchall()
    assert rows == [("unassigned",)]
    with pytest.raises(sa.exc.IntegrityError):
        _insert(conn, "ignored")
