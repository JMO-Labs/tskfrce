"""Shared pytest fixtures: basic database setup."""

import os
import sys
import tempfile
from unittest.mock import MagicMock

# Mock external dependencies to avoid import chain
sys.modules["apprise"] = MagicMock()
sys.modules["PIL"] = MagicMock()
sys.modules["PIL.Image"] = MagicMock()
sys.modules["PIL.ImageOps"] = MagicMock()
sys.modules["PIL.ImageSequence"] = MagicMock()
sys.modules["segno"] = MagicMock()
sys.modules["prometheus_client"] = MagicMock()

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="task4ce-test-"))
os.environ.setdefault("LOCK_LOOP_ENABLED", "false")

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app.core.database import Base, _import_all_models


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
