"""A family saved at the removed wizard step 8 is finished by the migration."""

import os
import sqlite3
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
PREV = "v5e6f7a8b9c0"


def _alembic(url, target, data):
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", target],
        cwd=BACKEND,
        env={**os.environ, "DATABASE_URL": url, "DATA_DIR": str(data)},
        check=True,
        capture_output=True,
    )


def test_step_8_becomes_finished(tmp_path):
    path, data = tmp_path / "m.db", tmp_path / "data"
    url = f"sqlite:///{path}"
    _alembic(url, PREV, data)
    con = sqlite3.connect(path)
    # fill every NOT NULL column with a neutral value, then set the two steps under test
    cols = [r for r in con.execute("PRAGMA table_info(family_settings)") if r[3] and r[4] is None and r[1] != "id"]
    names = ", ".join(["id", "setup_step"] + [c[1] for c in cols])
    fill = ", ".join("''" if (c[2] or "").upper().startswith(("VARCHAR", "TEXT")) else "0" for c in cols)
    for i, step in ((1, 8), (2, 5)):
        con.execute(f"INSERT INTO family_settings ({names}) VALUES ({i}, {step}, {fill})")
    con.commit()
    con.close()
    _alembic(url, "head", data)
    con = sqlite3.connect(path)
    assert con.execute("SELECT setup_step FROM family_settings ORDER BY id").fetchall() == [(None,), (5,)]
