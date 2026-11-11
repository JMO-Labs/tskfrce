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
    alembic("downgrade", "f1a2b3c4d5e7")  # just below goals, whatever comes after it
    assert "goals" not in inspect(create_engine(url)).get_table_names()
    alembic("upgrade", "head")
    insp = inspect(create_engine(url))
    assert {"goals", "goal_contributions", "goal_auto", "goal_parties"} <= set(
        insp.get_table_names()
    )
    sql = "".join(str(c["sqltext"]) for c in insp.get_check_constraints("points"))
    assert "goal_save" in sql and "goal_return" in sql


def test_penalties_migration_round_trips(tmp_path):
    url = f"sqlite:///{tmp_path / 'pen.db'}"

    def alembic(*args):
        subprocess.run(
            [sys.executable, "-m", "alembic", *args],
            cwd=BACKEND,
            env={**os.environ, "DATABASE_URL": url},
            check=True,
        )

    alembic("upgrade", "head")
    assert "penalties" in inspect(create_engine(url)).get_table_names()
    alembic("downgrade", "h3b4c5d6e7f8")
    insp = inspect(create_engine(url))
    assert "penalties" not in insp.get_table_names()
    sql = "".join(str(c["sqltext"]) for c in insp.get_check_constraints("points"))
    assert "goal_save" in sql and "'penalty'" not in sql
    alembic("upgrade", "head")
    insp = inspect(create_engine(url))
    assert "penalties" in insp.get_table_names()
    sql = "".join(str(c["sqltext"]) for c in insp.get_check_constraints("points"))
    assert "goal_save" in sql and "'penalty'" in sql


def test_penalties_downgrade_removes_makeup_chores(tmp_path):
    from app.models.penalty import Penalty
    from app.models.user import UserRole
    from app.services import penalties
    from sqlalchemy import text
    from sqlalchemy.orm import Session

    from tests.conftest import _make_user

    url = f"sqlite:///{tmp_path / 'pdn.db'}"
    env = {**os.environ, "DATABASE_URL": url}
    run = [sys.executable, "-m", "alembic"]
    subprocess.run([*run, "upgrade", "head"], cwd=BACKEND, env=env, check=True)
    eng = create_engine(url)
    with Session(eng) as db:
        parent = _make_user(db, "mom", UserRole.PARENT)
        kid = _make_user(db, "kid", UserRole.KID)
        p = Penalty(kid_id=kid.id, kind="points", amount=1)
        db.add(p)
        db.flush()
        penalties._makeup_runs(db, kid, p, ["Sweep"], parent, None)
        db.commit()
    subprocess.run([*run, "downgrade", "h3b4c5d6e7f8"], cwd=BACKEND, env=env, check=True)
    with eng.connect() as c:
        for t in ("chores", "chore_assignments", "assignment_kids", "chore_runs"):
            assert c.execute(text(f"SELECT COUNT(*) FROM {t}")).scalar() == 0, t


def test_goal_jail_card_migration_round_trips(tmp_path):
    url = f"sqlite:///{tmp_path / 'jail.db'}"

    def alembic(*args):
        subprocess.run(
            [sys.executable, "-m", "alembic", *args],
            cwd=BACKEND,
            env={**os.environ, "DATABASE_URL": url},
            check=True,
        )

    cols = lambda: {c["name"] for c in inspect(create_engine(url)).get_columns("goals")}  # noqa: E731
    alembic("upgrade", "head")
    assert {"played_at", "penalty_id"} <= cols()
    alembic("downgrade", "d7e8f9a0b1c2")  # jail card parent (presets)
    assert not {"played_at", "penalty_id"} & cols()
    alembic("upgrade", "head")
    assert {"played_at", "penalty_id"} <= cols()
