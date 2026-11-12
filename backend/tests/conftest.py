"""Shared pytest fixtures: in-memory SQLite and an in-process API client."""

import os
import tempfile

# Keep generated secrets/db out of the real ./data (must precede app imports)
os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="task4ce-test-"))

os.environ.setdefault("LOCK_LOOP_ENABLED", "false")
os.environ.setdefault("INTEGRATIONS_LOOP_ENABLED", "false")
os.environ.setdefault("POWER_HEARTBEAT_ENABLED", "false")

import pytest  # noqa: E402
from app.api.deps import get_db  # noqa: E402
from app.core.database import Base, _import_all_models, get_db_session  # noqa: E402
from app.main import app, fastapi_app  # noqa: E402
from app.services.chore_types import seed as seed_chore_types  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, event  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402


@pytest.fixture(autouse=True)
def _reset_rate_limits():
    from app.core import lockout
    from app.core.ratelimit import reset

    reset()
    lockout.reset()
    from app.services import kid_handoff

    kid_handoff._store.clear()


TEST_PG = os.environ.get("TEST_DATABASE_URL", "")


@pytest.fixture(scope="session")
def _pg_engine():
    """One Postgres database per xdist worker, schema built once (TEST_DATABASE_URL only)."""
    from sqlalchemy import text
    from sqlalchemy.engine import make_url

    _import_all_models()
    worker = os.environ.get("PYTEST_XDIST_WORKER", "gw")
    base = make_url(TEST_PG)
    name = f"{base.database}_{worker}"
    admin = create_engine(base, isolation_level="AUTOCOMMIT")
    with admin.connect() as c:
        c.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        c.execute(text(f'CREATE DATABASE "{name}"'))
    admin.dispose()
    engine = create_engine(base.set(database=name))
    Base.metadata.create_all(engine)
    yield engine
    engine.dispose()


def _pg_session(engine):
    from sqlalchemy import text

    tables = ", ".join(f'"{t.name}"' for t in Base.metadata.sorted_tables)
    with engine.begin() as c:
        c.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))
    return sessionmaker(bind=engine, autoflush=False)()


@pytest.fixture
def db(request):
    """Fresh session per test: in-memory SQLite, or a truncated Postgres when TEST_DATABASE_URL is set."""
    _import_all_models()
    if TEST_PG:
        engine = None
        session = _pg_session(request.getfixturevalue("_pg_engine"))
    else:
        engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
        )
        event.listen(engine, "connect", lambda c, r: c.execute("PRAGMA foreign_keys=ON"))
        Base.metadata.create_all(engine)
        session = sessionmaker(bind=engine, autoflush=False)()
    seed_chore_types(session)
    session.commit()
    try:
        yield session
    finally:
        session.close()
        if engine is not None:
            engine.dispose()


@pytest.fixture
def client(db):
    """TestClient whose DB dependencies yield the test session."""

    def override():
        yield db

    fastapi_app.dependency_overrides[get_db] = override
    fastapi_app.dependency_overrides[get_db_session] = override
    try:
        yield TestClient(app, base_url="http://localhost")
    finally:
        fastapi_app.dependency_overrides.clear()


def _make_user(db, username, role):
    from app.core.auth import AuthService
    from app.models.user import User

    u = User(
        username=username,
        email=f"{username}@family.local",
        hashed_password=AuthService(db).get_password_hash("pw-12345"),
        full_name=username.title(),
        role=role,
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _headers(db, user):
    from app.core.auth import AuthService

    token = AuthService(db).create_access_token(data={"sub": str(user.id)})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def parent(db):
    from app.models.user import UserRole

    return _make_user(db, "mom", UserRole.PARENT)


@pytest.fixture
def kid(db):
    from app.models.user import UserRole

    return _make_user(db, "timmy", UserRole.KID)


@pytest.fixture
def parent_headers(db, parent):
    return _headers(db, parent)


@pytest.fixture
def kid_headers(db, kid):
    return _headers(db, kid)


@pytest.fixture
def pings(monkeypatch):
    """Run notify sends inline and record them instead of calling Apprise."""
    from app.services import notify

    sent = []
    monkeypatch.setattr(notify, "_submit", lambda fn, *a: fn(*a))
    monkeypatch.setattr(
        notify,
        "deliver",
        lambda urls, title, body, lt=None: (sent.append((urls, title, body)), (True, None))[1],
    )
    return sent
