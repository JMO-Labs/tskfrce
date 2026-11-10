import hashlib
import os
import uuid
from datetime import datetime
from pathlib import Path

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory
from app.cli import main as cli_main
from app.core.config import settings
from app.core.database import Base, _import_all_models
from app.models.chore_type import ChoreType
from app.models.user import User, UserRole
from app.services import db_move
from app.services.chore_types import seed as seed_chore_types
from sqlalchemy import create_engine, inspect, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

PG = os.environ.get("TEST_DATABASE_URL", "")
pg_only = pytest.mark.skipif(not PG, reason="Postgres only")
HEAD = ScriptDirectory.from_config(
    Config(str(Path(__file__).parents[1] / "alembic.ini"))
).get_current_head()


@pytest.fixture(autouse=True)
def _data_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "DATA_DIR", tmp_path)


def make_sqlite(path: Path, version: str | None = HEAD) -> str:
    _import_all_models()
    url = f"sqlite:///{path}"
    eng = create_engine(url)
    Base.metadata.create_all(eng)
    with Session(eng) as s:
        seed_chore_types(s)
        s.add(
            User(
                username="mom",
                email="m@x.io",
                hashed_password="h",
                role=UserRole.PARENT,
                created_at=datetime(2026, 1, 2, 3, 4, 5),
                trust_mode=True,
            )
        )
        s.commit()
    if version:
        with eng.begin() as c:
            c.execute(text("CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL)"))
            c.execute(text("INSERT INTO alembic_version VALUES (:v)"), {"v": version})
    eng.dispose()
    return url


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


@pytest.fixture
def pg_dst():
    base = make_url(PG)
    name = f"mig_{uuid.uuid4().hex[:8]}"
    admin = create_engine(base, isolation_level="AUTOCOMMIT")
    with admin.connect() as c:
        c.execute(text(f'CREATE DATABASE "{name}"'))
    url = base.set(database=name).render_as_string(False)
    yield url
    with admin.connect() as c:
        c.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
    admin.dispose()


def test_refuses_non_sqlite_source(tmp_path):
    with pytest.raises(db_move.MoveError):
        db_move.move("postgresql+psycopg://u:p@h/d", "postgresql+psycopg://u:p@h/e")


def test_refuses_sqlite_destination(tmp_path):
    src = make_sqlite(tmp_path / "a.db")
    with pytest.raises(db_move.MoveError):
        db_move.move(src, f"sqlite:///{tmp_path / 'b.db'}")


@pytest.mark.parametrize("version", [None, "deadbeef"])
def test_refuses_source_not_at_head(tmp_path, version):
    src = make_sqlite(tmp_path / "a.db", version)
    with pytest.raises(db_move.MoveError, match="start the app"):
        db_move.move(src, "postgresql+psycopg://u:p@localhost:1/x")


@pytest.mark.parametrize("argv", [[], ["migrate-to"], ["bogus"]])
def test_cli_usage(argv, capsys):
    assert cli_main(argv) == 2
    assert "migrate-to" in capsys.readouterr().out


def test_cli_failure_exit_1(tmp_path, capsys):
    src = make_sqlite(tmp_path / "a.db", None)
    settings_url = settings.DATABASE_URL
    try:
        settings.DATABASE_URL = src
        assert cli_main(["migrate-to", "postgres://u@localhost:1/x"]) == 1
    finally:
        settings.DATABASE_URL = settings_url
    assert "untouched" in capsys.readouterr().out


@pg_only
def test_copy_roundtrip(tmp_path, pg_dst, monkeypatch):
    src = make_sqlite(tmp_path / "a.db")
    before = sha(tmp_path / "a.db")
    counts = db_move.move(src, pg_dst)
    assert sha(tmp_path / "a.db") == before
    assert counts["users"] == 1 and counts["chore_types"] > 0
    assert list((tmp_path / "backups").glob("pre-migrate-*.db"))
    eng = create_engine(pg_dst)
    with eng.connect() as c:
        u = c.execute(select(User.__table__)).mappings().one()
        assert u["trust_mode"] is True and u["role"] == UserRole.PARENT
        assert u["created_at"] == datetime(2026, 1, 2, 3, 4, 5)
        assert c.execute(text("SELECT version_num FROM alembic_version")).scalar() == HEAD
    with Session(eng) as s:  # sequences continue after the copied max id
        s.add(ChoreType(name="new", glyph="x", builtin=False, position=99))
        s.commit()
    eng.dispose()


@pg_only
def test_refuses_nonempty_destination(tmp_path, pg_dst):
    src = make_sqlite(tmp_path / "a.db")
    eng = create_engine(pg_dst)
    with eng.begin() as c:
        c.execute(text("CREATE TABLE junk (id int)"))
    eng.dispose()
    with pytest.raises(db_move.MoveError):
        db_move.move(src, pg_dst)


@pg_only
def test_mismatch_rolls_back(tmp_path, pg_dst, monkeypatch):
    src = make_sqlite(tmp_path / "a.db")
    before = sha(tmp_path / "a.db")
    real = db_move._count
    monkeypatch.setattr(
        db_move,
        "_count",
        lambda c, t: (
            real(c, t) + (1 if t.name == "users" and c.dialect.name == "postgresql" else 0)
        ),
    )
    with pytest.raises(db_move.MoveError, match="users"):
        db_move.move(src, pg_dst)
    eng = create_engine(pg_dst)
    assert inspect(eng).get_table_names() == []
    eng.dispose()
    assert sha(tmp_path / "a.db") == before
