"""iPhone hand-off: a short typed code that moves a sign-in into the home-screen app.

ponytail: in-memory, single uvicorn process (see entrypoint.sh). A box restart just means
"ask a parent for a new code". Only sha256 hashes are kept; never log the raw code.

The old Safari access token lives on for up to ACCESS_TOKEN_EXPIRE_MINUTES (same kid, same
phone; accepted). Only its device secret is rotated.
"""

import hmac
import secrets
import threading
import time

from sqlalchemy.orm import Session

from app.core.claim import ALPHABET, normalize
from app.models.kid_device import KidDevice
from app.models.user import User
from app.services.kid_enroll import hash_token, kid_of

TTL = 15 * 60
MAX = 1000
_now = time.monotonic
_store: dict[str, tuple[int, str, float]] = {}  # sha256(code) -> (device_id, secret_hash, expires)
_lock = threading.Lock()


def _sweep() -> None:
    """Call with `_lock` held."""
    now = _now()
    for h in [h for h, v in _store.items() if v[2] <= now]:
        _store.pop(h, None)


def issue(dev: KidDevice) -> str:
    """One live code per device; a new one drops the old. Returns 'XXXX-XXXX'."""
    raw = "".join(secrets.choice(ALPHABET) for _ in range(8))
    with _lock:
        _sweep()
        for h in [h for h, v in _store.items() if v[0] == dev.id]:
            _store.pop(h, None)
        _store[hash_token(raw)] = (dev.id, dev.secret_hash, _now() + TTL)
        while len(_store) > MAX:
            _store.pop(next(iter(_store)), None)  # dicts keep insertion order: drop oldest
    return f"{raw[:4]}-{raw[4:]}"


def redeem(db: Session, typed: str) -> tuple[User, KidDevice, str] | None:
    """Spend the code and rotate the device secret so the Safari copy stops working."""
    with _lock:
        _sweep()
        hit = _store.pop(hash_token(normalize(typed)), None)
    dev = db.get(KidDevice, hit[0]) if hit else None
    # the id may have been reused by a newer phone: the code is bound to the secret it was issued for
    if dev is None or not hmac.compare_digest(dev.secret_hash, hit[1]):
        return None
    kid = kid_of(db, dev)
    if kid is None:
        return None
    secret = secrets.token_urlsafe(32)
    dev.secret_hash = hash_token(secret)
    db.commit()
    return kid, dev, secret
