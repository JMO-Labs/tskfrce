"""iPhone hand-off: a short typed code that moves a sign-in into the home-screen app.

ponytail: in-memory, single uvicorn process (see entrypoint.sh). A box restart just means
"ask a parent for a new code". Only sha256 hashes are kept; never log the raw code.
"""

import secrets
import time

from sqlalchemy.orm import Session

from app.core.claim import ALPHABET, normalize
from app.models.kid_device import KidDevice
from app.models.user import User
from app.services.kid_enroll import hash_token, kid_of

TTL = 15 * 60
MAX = 1000
_now = time.monotonic
_store: dict[str, tuple[int, float]] = {}  # sha256(code) -> (device_id, expires)


def _sweep() -> None:
    now = _now()
    for h in [h for h, (_, exp) in _store.items() if exp <= now]:
        del _store[h]


def issue(device_id: int) -> str:
    """One live code per device; a new one drops the old. Returns 'XXXX-XXXX'."""
    _sweep()
    for h in [h for h, (d, _) in _store.items() if d == device_id]:
        del _store[h]
    raw = "".join(secrets.choice(ALPHABET) for _ in range(8))
    _store[hash_token(raw)] = (device_id, _now() + TTL)
    while len(_store) > MAX:
        del _store[next(iter(_store))]  # dicts keep insertion order: drop oldest
    return f"{raw[:4]}-{raw[4:]}"


def redeem(db: Session, typed: str) -> tuple[User, KidDevice, str] | None:
    """Spend the code and rotate the device secret so the Safari copy stops working."""
    _sweep()
    hit = _store.pop(hash_token(normalize(typed)), None)
    dev = db.get(KidDevice, hit[0]) if hit else None
    kid = kid_of(db, dev) if dev else None
    if dev is None or kid is None:
        return None
    secret = secrets.token_urlsafe(32)
    dev.secret_hash = hash_token(secret)
    db.commit()
    return kid, dev, secret
