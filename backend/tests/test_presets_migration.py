"""Preset columns exist; saved wizard steps 4..8 collapse to step 4; kids expose the new fields."""

import os
import sqlite3
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
PREV = "f1a2b3c4d5e7"
API = "/api/v1"


def _alembic(url, target, data):
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", target],
        cwd=BACKEND,
        env={**os.environ, "DATABASE_URL": url, "DATA_DIR": str(data)},
        check=True,
        capture_output=True,
    )


def test_steps_move_and_columns_added(tmp_path):
    path, data = tmp_path / "m.db", tmp_path / "data"
    url = f"sqlite:///{path}"
    _alembic(url, PREV, data)
    con = sqlite3.connect(path)
    cols = [
        r
        for r in con.execute("PRAGMA table_info(family_settings)")
        if r[3] and r[4] is None and r[1] != "id"
    ]
    names = ", ".join(["id", "setup_step"] + [c[1] for c in cols])
    fill = ", ".join(
        "''" if (c[2] or "").upper().startswith(("VARCHAR", "TEXT")) else "0" for c in cols
    )
    for i, step in enumerate((8, 7, 5, 4, 3, None), start=1):
        v = "NULL" if step is None else step
        con.execute(f"INSERT INTO family_settings ({names}) VALUES ({i}, {v}, {fill})")
    con.commit()
    con.close()
    _alembic(url, "head", data)
    con = sqlite3.connect(path)
    steps = con.execute("SELECT setup_step FROM family_settings ORDER BY id").fetchall()
    assert steps == [(4,), (4,), (4,), (4,), (3,), (None,)]
    fam = {r[1] for r in con.execute("PRAGMA table_info(family_settings)")}
    assert {"preset_style", "preset_base"} <= fam
    users = {r[1]: r for r in con.execute("PRAGMA table_info(users)")}
    assert "preset_style" in users and "chores_lock" in users


def test_kid_has_lock_and_style_fields(client, parent_headers, kid):
    r = client.get(f"{API}/kids", headers=parent_headers)
    k = next(x for x in r.json() if x["id"] == kid.id)
    assert k["chores_lock"] is True
    assert k["preset_style"] is None
    r = client.patch(f"{API}/kids/{kid.id}", json={"chores_lock": False}, headers=parent_headers)
    assert r.json()["chores_lock"] is False
