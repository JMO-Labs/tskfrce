"""Claim code: the sticker code that lets the first parent claim a box."""

import hmac

from sqlalchemy.orm import Session

from app.core.config import normalize_claim_code as normalize
from app.core.config import settings
from app.models.family import owner_set

__all__ = ["matches", "normalize", "required"]


def matches(raw: str | None) -> bool:
    """Constant-time check of a typed code. Never log `raw`."""
    code = settings.CLAIM_CODE
    if not code or raw is None:
        return False
    return hmac.compare_digest(normalize(raw).encode(), code.encode())


def required(db: Session) -> bool:
    """A claim code guards setup until the first parent owns the box."""
    return bool(settings.CLAIM_CODE) and not owner_set(db)
