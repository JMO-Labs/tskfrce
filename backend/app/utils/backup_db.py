"""Back up the DB to DATA_DIR/backups/pre-upgrade-<UTC stamp> (run before migrating).

SQLite: online backup API (WAL-safe) -> .db. Server DBs: gzip JSON dump of every table -> .json.gz.
"""

import gzip
import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path

from app.core.config import settings
from app.core.database import Base, _import_all_models
from sqlalchemy import create_engine, select
from sqlalchemy.engine import Engine


def backup_sqlite(src: Path, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    s, d = sqlite3.connect(src), sqlite3.connect(dest)
    try:
        s.backup(d)
        d.execute("PRAGMA journal_mode=DELETE")  # one self-contained file, no -wal/-shm
    finally:
        d.close()
        s.close()


def dump_json(engine: Engine, path: Path) -> None:
    _import_all_models()
    path.parent.mkdir(parents=True, exist_ok=True)
    with engine.connect() as conn, gzip.open(path, "wt") as f:
        data = {
            t.name: [dict(r) for r in conn.execute(select(t)).mappings()]
            for t in Base.metadata.sorted_tables
        }
        json.dump(data, f, default=str)


def main() -> None:
    url = settings.DATABASE_URL or ""
    if not url:
        return
    dest_dir = settings.DATA_DIR / "backups"
    stamp = f"{datetime.now(UTC):%Y%m%d%H%M%S}"
    if url.startswith("sqlite:///"):
        src = Path(url.removeprefix("sqlite:///"))
        if not src.is_file():
            return
        dest = dest_dir / f"pre-upgrade-{stamp}.db"
        backup_sqlite(src, dest)
    else:
        dest = dest_dir / f"pre-upgrade-{stamp}.json.gz"
        engine = create_engine(url)
        try:
            dump_json(engine, dest)
        finally:
            engine.dispose()
    print(f"Backed up database to {dest}")


if __name__ == "__main__":
    main()
