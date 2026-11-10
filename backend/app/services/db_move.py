"""Move a SQLite DB into an empty server (Postgres) DB: one transaction, counts verified, SQLite untouched."""

from datetime import UTC, datetime
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import Integer, create_engine, func, inspect, select, text
from sqlalchemy.engine import make_url

from app.core.config import normalize_db_url, settings
from app.core.database import Base, _import_all_models
from app.utils.backup_db import backup_sqlite

BATCH = 500


class MoveError(Exception):
    pass


def _head() -> str:
    ini = Path(__file__).parents[2] / "alembic.ini"
    return ScriptDirectory.from_config(Config(str(ini))).get_current_head()


def _count(conn, table) -> int:
    return conn.execute(select(func.count()).select_from(table)).scalar_one()


def _at_head(conn) -> bool:
    if not inspect(conn).has_table("alembic_version"):
        return False
    return conn.execute(text("SELECT version_num FROM alembic_version")).scalar() == _head()


def _fix_sequences(conn, tables) -> None:
    for t in tables:
        pk = list(t.primary_key.columns)
        if len(pk) == 1 and pk[0].name == "id" and isinstance(pk[0].type, Integer):
            conn.execute(
                text(
                    f"SELECT setval(pg_get_serial_sequence('{t.name}','id'), "
                    f"COALESCE(MAX(id),1), MAX(id) IS NOT NULL) FROM {t.name}"
                )
            )


def move(src_url: str, dst_url: str) -> dict[str, int]:
    dst_url = normalize_db_url(dst_url)
    if not src_url.startswith("sqlite"):
        raise MoveError("The current database is not SQLite; nothing to move.")
    if dst_url.startswith("sqlite"):
        raise MoveError("The target must be a Postgres URL, not SQLite.")
    path = make_url(src_url).database
    _import_all_models()
    src_eng = create_engine(f"sqlite:///file:{path}?mode=ro&uri=true")
    dst_eng = create_engine(dst_url)
    try:
        with src_eng.connect() as src:
            if not _at_head(src):
                raise MoveError("The database is not up to date; start the app once, then retry.")
            with dst_eng.connect() as probe:
                if inspect(probe).get_table_names():
                    raise MoveError("The target database is not empty.")
            stamp = f"{datetime.now(UTC):%Y%m%d%H%M%S}"
            backup_sqlite(Path(path), settings.DATA_DIR / "backups" / f"pre-migrate-{stamp}.db")
            tables = Base.metadata.sorted_tables
            counts: dict[str, int] = {}
            with dst_eng.begin() as dst:
                Base.metadata.create_all(dst)
                dst.execute(text("CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL)"))
                dst.execute(text("INSERT INTO alembic_version VALUES (:v)"), {"v": _head()})
                for t in tables:
                    for rows in src.execute(select(t)).mappings().partitions(BATCH):
                        dst.execute(t.insert(), [dict(r) for r in rows])
                _fix_sequences(dst, tables)
                for t in tables:
                    counts[t.name] = _count(src, t)
                    if _count(dst, t) != counts[t.name]:
                        raise MoveError(f"Row count mismatch in table {t.name}.")
            return counts
    finally:
        src_eng.dispose()
        dst_eng.dispose()
