"""Migration p7v8s9n0l1h2: devices.held_provisional added, then dropped.

Runs upgrade()/downgrade() in-process so coverage sees the migration lines.
"""

import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

PATH = Path(__file__).resolve().parent.parent / "alembic/versions/p7v8s9n0l1h2_held_provisional.py"


def _load():
    spec = importlib.util.spec_from_file_location("mig_held_prov", PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _cols(c):
    return {x["name"] for x in sa.inspect(c).get_columns("devices")}


def test_upgrade_adds_and_downgrade_drops_column():
    engine = sa.create_engine("sqlite://")
    with engine.begin() as c:
        c.exec_driver_sql("CREATE TABLE devices (id INTEGER PRIMARY KEY)")
        c.exec_driver_sql("INSERT INTO devices (id) VALUES (1)")
        mod = _load()
        with Operations.context(MigrationContext.configure(c)):
            mod.upgrade()
            assert "held_provisional" in _cols(c)
            assert c.exec_driver_sql("SELECT held_provisional FROM devices").scalar() == 0
            mod.downgrade()
        assert "held_provisional" not in _cols(c)
