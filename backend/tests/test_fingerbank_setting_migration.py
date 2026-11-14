"""Migration f2n3g4e5r6b7: Fingerbank columns on family_settings, up and down."""

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

PATH = (
    Path(__file__).resolve().parent.parent / "alembic/versions/f2n3g4e5r6b7_fingerbank_setting.py"
)
NEW = {"fingerbank_enabled", "fingerbank_cloud", "fingerbank_hint_seen",
       "fingerbank_api_key", "fingerbank_synced_at", "fingerbank_attempted_at",
       "fingerbank_last_error", "fingerbank_last_error_at"}  # fmt: skip


def _load():
    spec = importlib.util.spec_from_file_location("mig_fingerbank_setting", PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture
def conn():
    with sa.create_engine("sqlite://").begin() as c:
        c.exec_driver_sql("CREATE TABLE family_settings (id INTEGER PRIMARY KEY, name TEXT)")
        c.exec_driver_sql("INSERT INTO family_settings (name) VALUES ('f')")
        yield c


def _cols(c):
    return {r[1] for r in c.exec_driver_sql("PRAGMA table_info(family_settings)")}


def test_up_and_down(conn):
    mod = _load()
    with Operations.context(MigrationContext.configure(conn)):
        mod.upgrade()
        assert NEW <= _cols(conn)
        q = "select fingerbank_enabled, fingerbank_api_key from family_settings"
        assert conn.exec_driver_sql(q).fetchone() == (0, None)
        mod.downgrade()
    assert not NEW & _cols(conn)
