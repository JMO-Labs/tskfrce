"""Claim code: the sticker code that lets the first parent claim a box."""

import hmac

from sqlalchemy.orm import Session

from app.core.config import normalize_claim_code as normalize
from app.core.config import settings
from app.models.family import owner_set
from app.models.user import User

ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"  # Crockford base32

__all__ = ["ALPHABET", "matches", "normalize", "required"]


def matches(raw: str | None) -> bool:
    """Constant-time check of a typed code. Never log `raw`."""
    code = settings.CLAIM_CODE
    if not code or raw is None:
        return False
    return hmac.compare_digest(normalize(raw).encode(), code.encode())


def required(db: Session) -> bool:
    """A claim code guards a fresh box: no users yet and no owner."""
    if not settings.CLAIM_CODE or owner_set(db):
        return False
    return db.query(User.id).first() is None
