"""Lock/unlock/status a device via the blocker API. Runs INSIDE the backend container.

Usage: docker exec -i task4ce-backend-1 python - <lock|unlock|status> <mac> < boxctl.py
"""

import datetime as dt
import json
import sys
import urllib.request

BASE = "http://127.0.0.1:8000/api/v1"


def token() -> str:
    import jwt
    from app.core.auth import SECRET_KEY
    from app.core.database import SessionLocal
    from app.models.user import User, UserRole

    with SessionLocal() as db:
        parent = (
            db.query(User)
            .filter(User.role == UserRole.PARENT, User.is_active == True)  # noqa: E712
            .order_by(User.id)
            .first()
        )
        exp = dt.datetime.now(dt.UTC) + dt.timedelta(minutes=10)
        return jwt.encode(
            {"sub": str(parent.id), "type": "access", "exp": exp}, SECRET_KEY, "HS256"
        )


def call(tok: str, path: str, body: dict | None = None):
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(body).encode() if body is not None else None,
        method="POST" if body is not None else "GET",
        headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read() or b"null")


def main() -> int:
    cmd, mac = sys.argv[1], sys.argv[2].lower()
    tok = token()
    dev = next((d for d in call(tok, "/devices") if (d.get("mac") or "").lower() == mac), None)
    if dev is None:
        print(json.dumps({"ok": False, "error": f"no device {mac}"}))
        return 1
    if cmd in ("lock", "unlock"):
        call(tok, f"/devices/{dev['id']}/override", {"action": cmd})
        print(json.dumps({"ok": True, "id": dev["id"]}))
    elif cmd == "status":
        act = call(tok, f"/devices/{dev['id']}/activity")
        print(json.dumps({"device": dev, "activity": act}, default=str))
    else:
        print(json.dumps({"ok": False, "error": f"bad cmd {cmd}"}))
        return 1
    return 0


try:
    code = main()
except Exception as e:  # report as JSON, exit 1
    print(json.dumps({"ok": False, "error": repr(e)}))
    code = 1
sys.exit(code)
