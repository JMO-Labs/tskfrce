"""Claim code: typing-forgiving match, setting validation, owner gate."""

import pytest
from app.core import claim
from app.core.config import Settings, settings
from app.models.family import get_family
from app.models.user import User, UserRole

CODE = "K7M2QXA9PB"


@pytest.fixture
def cfg(monkeypatch):
    monkeypatch.setattr(settings, "CLAIM_CODE", CODE)


@pytest.mark.parametrize("typed", ["k7m2q-xa9pb", "K7M2Q XA9PB", " k7m2qxa9pb ", "K7M2QXA9PB"])
def test_normalize_forgives_typing(typed, cfg):
    assert claim.matches(typed)


def test_normalize_maps_lookalikes():
    assert claim.normalize("oIl-O") == "0110"


def test_wrong_code_false(cfg):
    assert claim.matches("K7M2QXA9PC") is False
    assert claim.matches("é") is False  # non-ASCII must not raise


def test_none_false(cfg):
    assert claim.matches(None) is False


def test_unset_setting_false(monkeypatch):
    monkeypatch.setattr(settings, "CLAIM_CODE", None)
    assert claim.matches(CODE) is False


def test_required_until_owner(db, cfg, monkeypatch):
    assert claim.required(db) is True
    user = User(
        username="mom", email="m@x.io", hashed_password="x", role=UserRole.PARENT, full_name="Mom"
    )
    db.add(user)
    db.flush()
    get_family(db).owner_id = user.id
    db.flush()
    assert claim.required(db) is False
    get_family(db).owner_id = None
    monkeypatch.setattr(settings, "CLAIM_CODE", None)
    assert claim.required(db) is False


def test_settings_rejects_bad_code():
    with pytest.raises(ValueError, match="CLAIM_CODE must be 10 Crockford base32 chars"):
        Settings(CLAIM_CODE="short")
    assert Settings(CLAIM_CODE="k7m2q-xa9pb").CLAIM_CODE == CODE


def test_empty_setting_is_unset():
    assert Settings(CLAIM_CODE="").CLAIM_CODE is None


def test_not_required_when_users_exist_without_owner(db, cfg):
    db.add(User(username="d", email="d@x.io", hashed_password="x", role=UserRole.PARENT))
    db.flush()
    assert claim.required(db) is False
