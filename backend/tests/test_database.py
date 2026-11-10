"""Real file-backed SQLite behavior: pragmas, concurrent setup, error mapping."""

import os
import threading
import time

import pytest
from app.api.setup import claim_owner
from app.core.database import Base, _import_all_models, make_engine
from app.models.family import FamilySettings
from app.models.user import User, UserRole
from sqlalchemy import text
from sqlalchemy.orm import sessionmaker


@pytest.fixture
def file_engine(tmp_path):
    _import_all_models()
    eng = make_engine(f"sqlite:///{tmp_path / 't.db'}")
    Base.metadata.create_all(eng)
    yield eng
    eng.dispose()


def test_file_sqlite_has_wal_and_fk_on(file_engine):
    with file_engine.connect() as c:
        assert c.execute(text("PRAGMA journal_mode")).scalar() == "wal"
        assert c.execute(text("PRAGMA foreign_keys")).scalar() == 1
        assert c.execute(text("PRAGMA busy_timeout")).scalar() == 5000
        # WAL + NORMAL: no fsync per commit (SD cards), never corrupts; a power cut may drop the last commit
        assert c.execute(text("PRAGMA synchronous")).scalar() == 1


def test_two_sessions_setup_yields_one_owner(file_engine):
    """B's setup runs in a thread while A holds the write lock; B must lose the CAS."""
    S = sessionmaker(bind=file_engine, autoflush=False)
    with S() as seed:
        seed.add(FamilySettings(id=1))
        seed.commit()

    def attempt(db, name):
        u = User(username=name, email=f"{name}@x.local", hashed_password="x", role=UserRole.PARENT)
        db.add(u)
        db.flush()
        return u.id, claim_owner(db, u.id, "Fam", "UTC")

    a, b_result = S(), {}
    uid_a, won_a = attempt(a, "a")  # A now holds the write transaction

    def run_b():
        with S() as b:
            b_result["won"] = attempt(b, "b")[1]  # blocks on busy_timeout until A commits
            b.rollback()

    t = threading.Thread(target=run_b)
    t.start()
    time.sleep(0.3)
    a.commit()
    a.close()
    t.join(10)
    assert won_a == 1 and b_result["won"] == 0
    with S() as check:
        assert check.get(FamilySettings, 1).owner_id == uid_a
        assert check.query(User).count() == 1


@pytest.mark.skipif(not os.environ.get("TEST_DATABASE_URL"), reason="Postgres only")
def test_postgres_sessions_run_in_utc_whatever_the_server_zone():
    """Times are naive UTC; a family's own server in local time must not shift them."""
    from sqlalchemy.engine import make_url

    url = make_url(os.environ["TEST_DATABASE_URL"])
    admin = make_engine(url.render_as_string(hide_password=False))
    with admin.connect() as c:
        c.execute(text(f"ALTER DATABASE \"{url.database}\" SET timezone TO 'America/Denver'"))
        c.commit()
    admin.dispose()
    eng = make_engine(url.render_as_string(hide_password=False))
    try:
        with eng.connect() as c:
            assert c.execute(text("SHOW timezone")).scalar() == "UTC"
    finally:
        with eng.connect() as c:
            c.execute(text(f'ALTER DATABASE "{url.database}" RESET timezone'))
            c.commit()
        eng.dispose()
