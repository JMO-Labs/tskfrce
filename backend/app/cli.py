"""Box-side commands. Password reset: docker compose exec backend python -m app.cli reset-password <name>"""

import sys

from app.core.config import settings
from app.core.database import SessionLocal, _import_all_models
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
    if len(argv) == 2 and argv[0] == "migrate-to":
        return migrate_to(argv[1])
    print("Usage: python -m app.cli reset-password <parent-username> | migrate-to <postgres-url>")
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
