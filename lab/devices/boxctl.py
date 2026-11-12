"""Lock/unlock/status a device via the blocker API. Runs INSIDE the backend container.

Usage: docker exec -i task4ce-backend-1 python - <lock|unlock|status> <mac> < boxctl.py
Identity-lab extras (arg is an ISO naive-UTC time, e.g. 2026-11-12T20:00:00, or a mac):
  list                  all devices: id/mac/ip/online/override/status/hint
  since <iso>           devices first seen after <iso> + events + parent notifications after <iso>
  delete <mac>          purge a lab-created device: locally-administered MAC AND first_seen today only
  mine <mac>            compact row for one mac (null if the box has no such device)
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


def row(d: dict) -> dict:
    keys = ("id", "mac", "ip", "hostname", "online", "status", "random_mac", "hint_of_id",
            "hint_reason", "model", "first_seen", "last_seen", "resisting", "blocked_since")  # fmt: skip
    return {**{k: d.get(k) for k in keys}, "override": (d.get("override") or {}).get("action")}


def since(iso: str) -> dict:
    from app.core.database import SessionLocal
    from app.models.device_activity import DeviceEvent
    from app.models.inbox import Notification

    t = dt.datetime.fromisoformat(iso)
    tok = token()
    devs = [d for d in call(tok, "/devices") if (d.get("first_seen") or "") > iso]
    with SessionLocal() as db:
        ev = db.query(DeviceEvent).filter(DeviceEvent.at >= t).order_by(DeviceEvent.id).all()
        nt = db.query(Notification).filter(Notification.created_at >= t).order_by(Notification.id)
        seen, notes = set(), []
        for n in nt:  # one row per parent: collapse on (kind,title,device)
            k = (n.kind, n.title, n.device_id)
            if k not in seen:
                seen.add(k)
                notes.append({"at": str(n.created_at), "kind": n.kind, "title": n.title, "device_id": n.device_id})  # fmt: skip
        events = [
            {"id": e.id, "device_id": e.device_id, "kind": e.kind, "at": str(e.at), "reason": e.reason,
             "other": e.other_device_id, "minutes": e.minutes, "detail": e.detail}
            for e in ev
        ]  # fmt: skip
    return {"devices": [row(d) for d in devs], "events": events, "notifications": notes}


def main() -> int:
    cmd = sys.argv[1]
    arg = sys.argv[2].lower() if len(sys.argv) > 2 else ""
    if cmd == "since":
        print(json.dumps(since(sys.argv[2]), default=str))
        return 0
    tok = token()
    devs = call(tok, "/devices")
    if cmd == "list":
        print(json.dumps([row(d) for d in devs]))
        return 0
    dev = next((d for d in devs if (d.get("mac") or "").lower() == arg), None)
    if cmd == "mine":
        print(json.dumps(row(dev) if dev else None))
        return 0
    if dev is None:
        print(json.dumps({"ok": False, "error": f"no device {arg}"}))
        return 1
    mac = arg
    if cmd == "delete":
        today = dt.datetime.now(dt.UTC).strftime("%Y-%m-%d")
        if not (int(mac[:2], 16) & 2) or not (dev.get("first_seen") or "").startswith(today):
            print(
                json.dumps({"ok": False, "error": "refusing: not a lab-created private-MAC device"})
            )
            return 1
        req = urllib.request.Request(
            f"{BASE}/devices/{dev['id']}",
            method="DELETE",
            headers={"Authorization": f"Bearer {tok}"},
        )
        urllib.request.urlopen(req, timeout=20).read()
        print(json.dumps({"ok": True, "deleted": dev["id"], "mac": mac}))
    elif cmd in ("lock", "unlock"):
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
