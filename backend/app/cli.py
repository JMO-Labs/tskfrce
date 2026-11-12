"""Box-side commands. Password reset: docker compose exec backend python -m app.cli reset-password <name>
PIN set (no data loss, bumps epoch): docker compose exec backend python -m app.cli set-pin"""

import sys
from getpass import getpass

from app.core.auth import AuthService
from app.core.config import settings
from app.core.database import SessionLocal, _import_all_models
from app.models.family import get_family
from app.models.user import User, UserRole
from app.services.password_reset import create_reset


def reset_password(username: str) -> int:
    _import_all_models()
    with SessionLocal() as db:
        parents = db.query(User).filter(User.role == UserRole.PARENT).order_by(User.id).all()
        user = next((p for p in parents if p.username.lower() == username.lower()), None)
        if user is None:
            names = ", ".join(p.username for p in parents) or "(none yet)"
            print(f"No parent named '{username}'. Parents on this box: {names}")
            return 1
        token = create_reset(db, user, None)
        name = user.username  # read before the session closes and detaches user
    base = (settings.BOX_URL or "http://<this-box>:3000").rstrip("/")
    print(f"Open this link to set a new password for {name} (works once, 30 minutes):")
    print(f"{base}/reset?token={token}")
    return 0


def set_pin_cmd() -> int:
    """Set a new parent PIN (no data loss, bumps token epoch)."""
    _import_all_models()
    with SessionLocal() as db:
        fam = get_family(db)
        owner_id = fam.owner_id
        if not owner_id:
            print("Error: No parent account found on this box.")
            return 1

        owner = db.query(User).filter(User.id == owner_id).first()
        if not owner:
            print("Error: Parent account not found.")
            return 1

        # Prompt for new PIN
        new_pin = getpass("Enter new PIN: ")
        if not new_pin or len(new_pin) < 8:
            print("Error: PIN must be at least 8 characters.")
            return 1

        # Hash and update password
        auth = AuthService(db)
        owner.hashed_password = auth.get_password_hash(new_pin)

        # Bump token_epoch to invalidate old sessions
        fam.token_epoch = (fam.token_epoch or 0) + 1

        db.commit()
        print("Parent PIN updated and sessions invalidated.")
        return 0


def migrate_to(url: str) -> int:
    from app.services.db_move import move

    try:
        counts = move(settings.DATABASE_URL or "", url)
    except Exception as e:
        print(f"Migration failed: {e}\nYour SQLite database is untouched.")
        return 1
    print(f"Moved {sum(counts.values())} rows in {len(counts)} tables. SQLite is untouched.")
    return 0


def main(argv: list[str]) -> int:
    if len(argv) == 2 and argv[0] == "reset-password":
        return reset_password(argv[1])
    if len(argv) == 1 and argv[0] == "set-pin":
        return set_pin_cmd()
    if len(argv) == 2 and argv[0] == "migrate-to":
        return migrate_to(argv[1])
    print(
        "Usage: python -m app.cli reset-password <parent-username> | set-pin | migrate-to <postgres-url>"
    )
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
