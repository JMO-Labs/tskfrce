"""DATABASE_URL accepts the postgres:// spellings people paste and uses psycopg 3."""

import pytest
from app.core.config import normalize_db_url


@pytest.mark.parametrize(
    "raw",
    ["postgres://u:p@h/db", "postgresql://u:p@h/db", "postgresql+psycopg://u:p@h/db"],
)
def test_postgres_spellings_use_psycopg(raw):
    assert normalize_db_url(raw) == "postgresql+psycopg://u:p@h/db"


def test_sqlite_untouched():
    assert normalize_db_url("sqlite:////data/task4ce.db") == "sqlite:////data/task4ce.db"
