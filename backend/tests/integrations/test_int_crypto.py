import base64
import hashlib

import pytest
from app.core.config import settings
from app.core.crypto import seal, unseal
from cryptography.fernet import Fernet


def test_purposes_are_separate():
    tok = seal("s3cret", purpose="integrations")
    assert unseal(tok, purpose="integrations") == "s3cret"
    with pytest.raises(ValueError):
        unseal(tok)  # apprise key cannot read it


def test_default_purpose_unchanged():
    assert unseal(seal("x")) == "x"


def test_legacy_apprise_token_still_unseals():
    # Token sealed by the pre-purpose algorithm: sha256("apprise:" + SECRET_KEY)
    digest = hashlib.sha256(("apprise:" + (settings.SECRET_KEY or "")).encode()).digest()
    legacy = Fernet(base64.urlsafe_b64encode(digest)).encrypt(b"apprise://old").decode()
    assert unseal(legacy) == "apprise://old"
    assert unseal(legacy, purpose="apprise") == "apprise://old"
