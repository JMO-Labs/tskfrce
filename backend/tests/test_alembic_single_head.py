"""Alembic history must have exactly one head (two heads break `upgrade head`)."""

from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory

BACKEND = Path(__file__).resolve().parent.parent


def test_single_alembic_head():
    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "alembic"))
    assert len(ScriptDirectory.from_config(cfg).get_heads()) == 1
