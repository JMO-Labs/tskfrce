"""Migration b1r2t3h4d5a6: users birth_month/birth_year/age_group_set_at up and down."""

import sqlite3

from tests.test_device_replaced_migration import alembic

PREV = "s1u2g3g4e5s6"
NEW = "b1r2t3h4d5a6"
NEW_COLS = {"birth_month", "birth_year", "age_group_set_at"}


def _cols(path):
    con = sqlite3.connect(path)
    try:
        return {r[1] for r in con.execute("PRAGMA table_info(users)")}
    finally:
        con.close()


def _ddl(path):
    con = sqlite3.connect(path)
    try:
        return con.execute("SELECT sql FROM sqlite_master WHERE name='users'").fetchone()[0]
    finally:
        con.close()


def test_upgrade_adds_columns_and_constraints_downgrade_removes(tmp_path):
    path = tmp_path / "mig.db"
    url = f"sqlite:///{path}"
    alembic(url, "upgrade", PREV)
    assert not NEW_COLS & _cols(path)
    alembic(url, "upgrade", NEW)
    assert NEW_COLS <= _cols(path)
    ddl = _ddl(path)
    for name in ("ck_user_birth_month", "ck_user_birth_year", "ck_user_birth_both_or_neither"):
        assert name in ddl
    alembic(url, "downgrade", PREV)
    assert not NEW_COLS & _cols(path)
    ddl = _ddl(path)
    assert "ck_user_birth" not in ddl
