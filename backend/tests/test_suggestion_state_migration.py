"""Migration s1u2g3g4e5s6: suggestion_state table up and down."""

import sqlite3

from tests.test_device_replaced_migration import alembic

PREV = "r1e2l3i4n5k6"
NEW = "s1u2g3g4e5s6"


def _tables(path):
    con = sqlite3.connect(path)
    try:
        names = {r[0] for r in con.execute("SELECT name FROM sqlite_master")}
        cols = {r[1]: r for r in con.execute("PRAGMA table_info(suggestion_state)")}
        return names, cols
    finally:
        con.close()


def test_upgrade_creates_and_downgrade_drops_suggestion_state(tmp_path):
    path = tmp_path / "mig.db"
    url = f"sqlite:///{path}"
    alembic(url, "upgrade", PREV)
    assert "suggestion_state" not in _tables(path)[0]
    alembic(url, "upgrade", NEW)
    names, cols = _tables(path)
    assert "ix_suggestion_state_family_id" in names
    assert {"id", "family_id", "key", "fingerprint", "muted", "at"} <= set(cols)
    assert cols["muted"][3] == 1  # NOT NULL
    alembic(url, "downgrade", PREV)
    names, _ = _tables(path)
    assert "suggestion_state" not in names
    assert "ix_suggestion_state_family_id" not in names
