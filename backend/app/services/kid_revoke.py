"""Cut off a user's kid phones. Call when a role leaves KID or the account is deactivated."""

from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.models.kid_device import KidDevice, KidEnrollToken
from app.models.user import User


def revoke_kid_access(db: Session, user: User) -> None:
    """Drop devices, void open enroll codes, clear the alert topic. Caller commits."""
    now = datetime.now(UTC).replace(tzinfo=None)
    db.query(KidDevice).filter(KidDevice.kid_id == user.id).delete(synchronize_session=False)
    db.query(KidEnrollToken).filter(
        KidEnrollToken.kid_id == user.id, KidEnrollToken.used_at.is_(None)
    ).update({KidEnrollToken.used_at: now}, synchronize_session=False)
    user.alert_topic = None
