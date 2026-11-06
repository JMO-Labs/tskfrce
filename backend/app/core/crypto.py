"""Reversible sealing of secrets (Apprise URLs) keyed off SECRET_KEY."""

import base64
import hashlib
from functools import cache

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings


@cache
def _fernet(purpose: str) -> Fernet:
    digest = hashlib.sha256((f"{purpose}:" + (settings.SECRET_KEY or "")).encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def seal(text: str, purpose: str = "apprise") -> str:
    return _fernet(purpose).encrypt(text.encode()).decode()


def unseal(token: str, purpose: str = "apprise") -> str:
    try:
        return _fernet(purpose).decrypt(token.encode()).decode()
    except InvalidToken as e:
        raise ValueError("unreadable") from e
