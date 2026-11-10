"""Alembic migrations build the schema from scratch."""

import os
import subprocess
import sys
from pathlib import Path

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


def test_goals_migration_round_trips(tmp_path):
    url = f"sqlite:///{tmp_path / 'goals.db'}"

    def alembic(*args):
        subprocess.run(
            [sys.executable, "-m", "alembic", *args],
            cwd=BACKEND,
            env={**os.environ, "DATABASE_URL": url},
            check=True,
        )

    alembic("upgrade", "head")
    alembic("downgrade", "-1")
    assert "goals" not in inspect(create_engine(url)).get_table_names()
    alembic("upgrade", "head")
    insp = inspect(create_engine(url))
    assert {"goals", "goal_contributions", "goal_auto", "goal_parties"} <= set(
        insp.get_table_names()
    )
    sql = "".join(str(c["sqltext"]) for c in insp.get_check_constraints("points"))
    assert "goal_save" in sql and "goal_return" in sql
