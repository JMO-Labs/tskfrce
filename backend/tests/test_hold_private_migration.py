"""Migration g2h3o4l5d6p7: devices.held and family hold flags, up and down."""

import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

PATH = Path(__file__).resolve().parent.parent / "alembic/versions/g2h3o4l5d6p7_hold_private_devices.py"


def _cols(c, table):
    return {r[1] for r in c.exec_driver_sql(f"PRAGMA table_info({table})").fetchall()}


def test_upgrade_and_downgrade():
    spec = importlib.util.spec_from_file_location("mig_hold_private", PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    with sa.create_engine("sqlite://").begin() as c:
        c.exec_driver_sql("CREATE TABLE devices (id INTEGER PRIMARY KEY)")
        c.exec_driver_sql("CREATE TABLE family_settings (id INTEGER PRIMARY KEY)")
        c.exec_driver_sql("INSERT INTO devices (id) VALUES (1)")
        with Operations.context(MigrationContext.configure(c)):
            mod.upgrade()
            assert "held" in _cols(c, "devices")
            assert {"hold_private_devices", "hold_private_hint"} <= _cols(c, "family_settings")
            assert c.exec_driver_sql("SELECT held FROM devices").scalar() == 0
            mod.downgrade()
        assert _cols(c, "devices") == {"id"} and _cols(c, "family_settings") == {"id"}
