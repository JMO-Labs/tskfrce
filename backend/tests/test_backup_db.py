import gzip
import json
import os
import sqlite3

import pytest
from app.core.config import settings
from app.core.database import Base, _import_all_models
from app.utils import backup_db


def test_sqlite_backup_includes_wal_rows(tmp_path, monkeypatch):
    path = tmp_path / "app.db"
    keeper = sqlite3.connect(path)
    keeper.execute("PRAGMA journal_mode=WAL")
    keeper.execute("CREATE TABLE t (v TEXT)")
    keeper.commit()
    keeper.execute("PRAGMA wal_autocheckpoint=0")
    keeper.execute("INSERT INTO t VALUES ('in-wal')")
    keeper.commit()
    monkeypatch.setattr(settings, "DATABASE_URL", f"sqlite:///{path}")
    monkeypatch.setattr(settings, "DATA_DIR", tmp_path)
    backup_db.main()
    keeper.close()
    (dest,) = (tmp_path / "backups").glob("pre-upgrade-*.db")
    assert sqlite3.connect(dest).execute("SELECT v FROM t").fetchall() == [("in-wal",)]


def test_no_db_file_does_nothing(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "DATABASE_URL", f"sqlite:///{tmp_path / 'none.db'}")
    monkeypatch.setattr(settings, "DATA_DIR", tmp_path)
    backup_db.main()
    assert not (tmp_path / "backups").exists()


@pytest.mark.skipif(not os.environ.get("TEST_DATABASE_URL"), reason="Postgres only")
def test_postgres_json_dump(tmp_path, monkeypatch, _pg_engine):
    _import_all_models()
    monkeypatch.setattr(settings, "DATABASE_URL", _pg_engine.url.render_as_string(False))
    monkeypatch.setattr(settings, "DATA_DIR", tmp_path)
    backup_db.main()
    (dest,) = (tmp_path / "backups").glob("pre-upgrade-*.json.gz")
    data = json.loads(gzip.open(dest).read())
    assert set(data) == {t.name for t in Base.metadata.sorted_tables}
