"""Alembic migrations build the schema from scratch."""

import os
import subprocess
import sys
from pathlib import Path

import pytest
from app.core.database import Base, _import_all_models
from sqlalchemy import create_engine, inspect

BACKEND = Path(__file__).resolve().parent.parent


def test_alembic_upgrade_creates_tables(tmp_path):
    url = f"sqlite:///{tmp_path / 'mig.db'}"
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=BACKEND,
        env={**os.environ, "DATABASE_URL": url},
        check=True,
    )
    tables = set(inspect(create_engine(url)).get_table_names()) - {"alembic_version"}
    _import_all_models()
    assert tables == set(Base.metadata.tables)


def test_integration_kinds_migration_round_trips(tmp_path):
    url = f"sqlite:///{tmp_path / 'rt.db'}"

    def alembic(*args):
        subprocess.run(
            [sys.executable, "-m", "alembic", *args],
            cwd=BACKEND,
            env={**os.environ, "DATABASE_URL": url},
            check=True,
        )

    alembic("upgrade", "head")
    alembic("downgrade", "c1d2e3f4a5b6")
    alembic("upgrade", "head")
    sql = "".join(
        c["sqltext"].text if hasattr(c["sqltext"], "text") else str(c["sqltext"])
        for c in inspect(create_engine(url)).get_check_constraints("notifications")
    )
    assert "integration_done" in sql


@pytest.mark.skipif(not os.environ.get("TEST_DATABASE_URL"), reason="Postgres only")
def test_fresh_postgres_starts_at_head_and_stays_there():
    """An empty server DB gets the model schema plus a head stamp; a rerun is a no-op."""
    from sqlalchemy import text
    from sqlalchemy.engine import make_url

    base = make_url(os.environ["TEST_DATABASE_URL"])
    name = f"{base.database}_alembic_{os.environ.get('PYTEST_XDIST_WORKER', 'gw')}"
    admin = create_engine(base, isolation_level="AUTOCOMMIT")
    with admin.connect() as c:
        c.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        c.execute(text(f'CREATE DATABASE "{name}"'))
    url = base.set(database=name).render_as_string(hide_password=False)
    env = {**os.environ, "DATABASE_URL": url}
    for _ in range(2):
        subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", "head"], cwd=BACKEND, env=env, check=True
        )
    eng = create_engine(url)
    _import_all_models()
    assert set(inspect(eng).get_table_names()) - {"alembic_version"} == set(Base.metadata.tables)
    heads = subprocess.run(
        [sys.executable, "-m", "alembic", "heads"],
        cwd=BACKEND,
        env=env,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.split()[0]
    with eng.connect() as c:
        assert c.execute(text("SELECT version_num FROM alembic_version")).scalar() == heads
    eng.dispose()
    with admin.connect() as c:
        c.execute(text(f'DROP DATABASE "{name}" WITH (FORCE)'))
    admin.dispose()
