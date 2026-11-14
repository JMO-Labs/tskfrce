"""Migration n4m5f6p7a8r9: devices.name_from_parent backfills every row as refreshable (0), downgrade drops it."""

import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

PATH = Path(__file__).resolve().parent.parent / "alembic/versions/n4m5f6p7a8r9_name_from_parent.py"


def test_up_and_down():
    spec = importlib.util.spec_from_file_location("mig_nfp", PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    with sa.create_engine("sqlite://").begin() as c:
        c.exec_driver_sql(
            "CREATE TABLE devices (id INTEGER PRIMARY KEY, name VARCHAR(50), "
            "hostname VARCHAR(255), mdns_name VARCHAR(255), vendor VARCHAR(255))"
        )
        c.exec_driver_sql(
            "INSERT INTO devices (name, hostname, mdns_name, vendor) VALUES "
            "('laptop','laptop',NULL,NULL),"  # auto-named from hostname
            "('Unknown device',NULL,NULL,NULL),"
            "('Apple device',NULL,NULL,'Apple'),"
            "('Emma''s tablet','android-1234',NULL,'Samsung'),"  # edits were never recorded: refreshable
            "('Kitchen',NULL,NULL,NULL),"
            "('k1-n2.maas','192-168-1-242.maas',NULL,NULL),"  # stale beta rows
            "('192-168-1-242.maas','k1-n2.maas',NULL,NULL)"
        )
        with Operations.context(MigrationContext.configure(c)):
            mod.upgrade()
            got = dict(c.exec_driver_sql("SELECT name, name_from_parent FROM devices").all())
            assert got == {
                "laptop": 0,
                "Unknown device": 0,
                "Apple device": 0,
                "Emma's tablet": 0,
                "Kitchen": 0,
                "k1-n2.maas": 0,
                "192-168-1-242.maas": 0,
            }
            mod.downgrade()
        cols = {r[1] for r in c.exec_driver_sql("PRAGMA table_info(devices)")}
        assert "name_from_parent" not in cols
