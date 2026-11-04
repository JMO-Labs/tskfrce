"""Shared pytest fixtures: in-memory SQLite and an in-process API client."""

import os
import sys
import tempfile
from unittest.mock import MagicMock

# Mock external dependencies before app imports
sys.modules["apprise"] = MagicMock()
sys.modules["PIL"] = MagicMock()
sys.modules["PIL.Image"] = MagicMock()
sys.modules["PIL.ImageOps"] = MagicMock()
sys.modules["PIL.ImageSequence"] = MagicMock()
sys.modules["segno"] = MagicMock()
sys.modules["prometheus_client"] = MagicMock()

# Keep generated secrets/db out of the real ./data (must precede app imports)
os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="task4ce-test-"))

os.environ.setdefault("LOCK_LOOP_ENABLED", "false")

import pytest  # noqa: E402
from app.core.database import Base, _import_all_models, get_db_session  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, event  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

try:
    from app.api.deps import get_db  # noqa: E402, F401
    from app.main import app, fastapi_app  # noqa: E402
except ImportError:
    # If full app cannot be imported, provide minimal fixtures
    app = None
    fastapi_app = None
    get_db = None


@pytest.fixture(autouse=True)
def _reset_rate_limits():
    try:
        from app.core.ratelimit import reset

        reset()
    except (ImportError, AttributeError):
        pass


@pytest.fixture
def db():
    """Fresh in-memory SQLite session per test."""
    _import_all_models()
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    event.listen(engine, "connect", lambda c, r: c.execute("PRAGMA foreign_keys=ON"))
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, autoflush=False)()
    try:
        from app.services.chore_types import seed as seed_chore_types

        seed_chore_types(session)
        session.commit()
    except ImportError:
        pass
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


@pytest.fixture
def client(db):
    """TestClient whose DB dependencies yield the test session."""
    if not fastapi_app or not get_db:
        pytest.skip("FastAPI app not available")

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
    try:
        from app.services import notify

        sent = []
        monkeypatch.setattr(notify, "_submit", lambda fn, *a: fn(*a))
        monkeypatch.setattr(
            notify,
            "deliver",
            lambda urls, title, body, lt=None: (sent.append((urls, title, body)), (True, None))[1],
        )
        return sent
    except ImportError:
        pytest.skip("notify service not available")
