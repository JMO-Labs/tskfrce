"""Migration 31ec443cea32: family_settings.token_epoch added, then dropped."""

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

PATH = (
    Path(__file__).resolve().parent.parent
    / "alembic/versions/31ec443cea32_box_reset_token_epoch_for_session_.py"
)


@pytest.fixture
def conn():
    engine = sa.create_engine("sqlite://")
    with engine.begin() as c:
        c.exec_driver_sql("CREATE TABLE family_settings (id INTEGER PRIMARY KEY, name TEXT)")
        c.exec_driver_sql("INSERT INTO family_settings (name) VALUES ('f')")
        yield c


def test_upgrade_adds_column_default_zero_and_downgrade_drops(conn):
    spec = importlib.util.spec_from_file_location("mig_epoch", PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    with Operations.context(MigrationContext.configure(conn)):
        mod.upgrade()
        assert conn.exec_driver_sql("SELECT token_epoch FROM family_settings").fetchall() == [(0,)]
        mod.downgrade()
    cols = [c["name"] for c in sa.inspect(conn).get_columns("family_settings")]
    assert "token_epoch" not in cols
