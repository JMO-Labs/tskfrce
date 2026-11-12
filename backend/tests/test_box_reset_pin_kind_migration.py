"""Migration 7b2e4c1a9f30: notifications accept kind 'box_reset_pin', then not."""

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from app.models.inbox import KINDS

PATH = (
    Path(__file__).resolve().parent.parent
    / "alembic/versions/7b2e4c1a9f30_box_reset_pin_notification_kind.py"
)


def _load():
    spec = importlib.util.spec_from_file_location("mig_reset_pin_kind", PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _insert(conn, kind):
    conn.exec_driver_sql(f"INSERT INTO notifications (kind) VALUES ('{kind}')")


def test_model_allows_box_reset_pin():
    assert "box_reset_pin" in KINDS
    assert _load().AFTER == KINDS


def test_upgrade_allows_kind_and_downgrade_removes_it():
    mod = _load()
    engine = sa.create_engine("sqlite://")
    with engine.begin() as conn:
        kinds = ",".join(f"'{k}'" for k in mod.BEFORE)
        conn.exec_driver_sql(
            "CREATE TABLE notifications (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, "
            f"CONSTRAINT ck_notification_kind CHECK (kind IN ({kinds})))"
        )
        with Operations.context(MigrationContext.configure(conn)):
            mod.upgrade()
            _insert(conn, "box_reset_pin")
            mod.downgrade()
        assert conn.exec_driver_sql("SELECT count(*) FROM notifications").scalar() == 0
        with pytest.raises(sa.exc.IntegrityError):
            _insert(conn, "box_reset_pin")
