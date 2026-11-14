"""Migration n3t4w5k6i7d8: backfill devices.network_id from ip/CIDR."""

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

PATH = Path(__file__).resolve().parent.parent / "alembic/versions/n3t4w5k6i7d8_backfill_network_id.py"


@pytest.fixture
def conn():
    with sa.create_engine("sqlite://").begin() as c:
        c.exec_driver_sql("CREATE TABLE networks (id INTEGER PRIMARY KEY, iface TEXT, subnet TEXT)")
        c.exec_driver_sql("CREATE TABLE devices (id INTEGER PRIMARY KEY, ip TEXT, network_id INT)")
        c.exec_driver_sql("INSERT INTO networks VALUES (1,'eno2','192.168.1.0/24'),(2,'wlo1','192.168.2.0/24'),(3,'x',NULL)")
        c.exec_driver_sql(
            "INSERT INTO devices VALUES (1,'192.168.1.5',NULL),(2,'192.168.2.5',NULL),"
            "(3,'10.9.9.9',NULL),(4,NULL,NULL),(5,'192.168.2.6',1)"
        )
        yield c


def test_backfill(conn):
    spec = importlib.util.spec_from_file_location("mig_net", PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    with Operations.context(MigrationContext.configure(conn)):
        mod.upgrade()
        mod.downgrade()
    rows = dict(conn.exec_driver_sql("SELECT id, network_id FROM devices").fetchall())
    assert rows == {1: 1, 2: 2, 3: None, 4: None, 5: 1}  # existing values untouched
