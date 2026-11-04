"""Fixtures for lock tests - minimal setup."""

import os
import sys
import tempfile
from unittest.mock import MagicMock

# Mock ALL external dependencies to avoid import chain issues
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

# Import models directly without app.main
from app.core.database import Base, _import_all_models


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
        yield session
    finally:
        session.close()
        engine.dispose()


@pytest.fixture
def parent(db):
    """Create a parent user."""
    from app.models.user import User, UserRole
    parent = User(
        username="mom",
        email="mom@family.local",
        hashed_password="hashed",
        full_name="Mom",
        role=UserRole.PARENT,
    )
    db.add(parent)
    db.commit()
    db.refresh(parent)
    return parent
