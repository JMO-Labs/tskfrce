"""Kid phone enrollment: one-time QR tokens. Only sha256 hashes are stored; never log raw."""

import hashlib
import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.kid_device import KidEnrollToken
from app.models.user import User

ENROLL_TTL = timedelta(hours=24)


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)  # naive UTC, matches the columns


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def issue(db: Session, kid: User, by: User) -> tuple[str, datetime]:
    """Void the kid's open tokens, store a new one hashed, return (raw, expires_at)."""
    now = _now()
    db.query(KidEnrollToken).filter(
        KidEnrollToken.kid_id == kid.id,
        KidEnrollToken.used_at.is_(None),
        KidEnrollToken.expires_at > now,
    ).update({KidEnrollToken.used_at: now}, synchronize_session=False)
    raw = secrets.token_urlsafe(24)
    expires = now + ENROLL_TTL
    db.add(
        KidEnrollToken(
            kid_id=kid.id,
            token_hash=hash_token(raw),
            created_by_id=by.id,
            created_at=now,
            expires_at=expires,
        )
    )
    db.commit()
    return raw, expires


def enroll_url(raw: str) -> str:
    return f"{settings.BOX_URL.rstrip('/')}/kid#enroll={raw}"
