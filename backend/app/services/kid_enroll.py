"""Kid phone enrollment: one-time QR tokens. Only sha256 hashes are stored; never log raw."""

import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import update
from sqlalchemy.orm import Session

from app.api.deps import ACTIVE_EVERY
from app.core.auth import AuthService
from app.core.config import settings
from app.models.kid_device import KidDevice, KidEnrollToken
from app.models.user import User, UserRole

ENROLL_TTL = timedelta(hours=24)
SESSION_IDLE = timedelta(days=180)


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


def device_label(ua: str) -> str:
    if "iPad" in ua:
        return "iPad"
    if "iPhone" in ua:
        return "iPhone"
    if "Android" in ua:
        return "Android phone" if "Mobile" in ua else "Android tablet"
    return "Phone or computer"


def redeem(db: Session, raw: str, ua: str) -> tuple[User, KidDevice, str] | None:
    """Burn the token (compare-and-set: exactly one caller wins), then add a device session."""
    now = _now()
    th = hash_token(raw)
    won = db.execute(
        update(KidEnrollToken)
        .where(
            KidEnrollToken.token_hash == th,
            KidEnrollToken.used_at.is_(None),
            KidEnrollToken.expires_at > now,
        )
        .values(used_at=now)
    ).rowcount
    if won != 1:
        db.rollback()
        return None
    kid_id = db.query(KidEnrollToken.kid_id).filter(KidEnrollToken.token_hash == th).scalar()
    kid = db.get(User, kid_id)
    if kid is None or kid.role != UserRole.KID or not kid.is_active:
        db.commit()  # burn the code anyway; a parent issues a fresh one
        return None
    if kid.alert_topic is None:
        kid.alert_topic = secrets.token_urlsafe(24)
    secret = secrets.token_urlsafe(32)
    dev = KidDevice(
        kid_id=kid.id,
        secret_hash=hash_token(secret),
        label=device_label(ua),
        created_at=now,
        last_seen_at=now,
    )
    db.add(dev)
    db.commit()
    return kid, dev, secret


def kid_of(db: Session, dev: KidDevice) -> User | None:
    """The device's kid, only while that kid is active and still a kid."""
    kid = db.get(User, dev.kid_id)
    return kid if kid and kid.is_active and kid.role == UserRole.KID else None


def refresh(db: Session, raw_device: str) -> tuple[User, KidDevice] | None:
    """Device secret -> (kid, device). Idle past SESSION_IDLE deletes the session."""
    th = hash_token(raw_device)
    dev = db.query(KidDevice).filter(KidDevice.secret_hash == th).first()
    if dev is None or not hmac.compare_digest(dev.secret_hash, th):
        return None
    now = _now()
    if now - dev.last_seen_at > SESSION_IDLE:
        db.delete(dev)
        db.commit()
        return None
    kid = kid_of(db, dev)
    if kid is None:
        return None
    if now - dev.last_seen_at >= ACTIVE_EVERY:
        dev.last_seen_at = now
        db.commit()
    return kid, dev


def access_for(auth: AuthService, kid: User, dev: KidDevice) -> str:
    return auth.create_access_token(data={"sub": str(kid.id), "sid": dev.id})
