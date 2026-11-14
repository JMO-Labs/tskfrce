"""Relink lab helper. Runs INSIDE the backend container (stdin), like boxctl.py.

  kid NAME            ensure a lab kid named NAME exists; prints its id
  assign MAC KID_ID   make the device with MAC assigned to that kid only
  dev MAC             device row straight from the DB (includes replaced/hidden rows)
  purge MAC           delete the device row(s) for MAC (lab MACs only)

Only lab devices are touched: locally administered MACs or the two lab hardware MACs.
"""

import json
import sys

LAB_HW = {"c4:8b:66:54:72:0d", "98:22:ef:94:7e:f5"}


def lab_mac(m: str) -> str:
    m = m.lower()
    if m not in LAB_HW and not int(m[:2], 16) & 2:
        raise SystemExit(f"refusing non-lab mac {m}")
    return m


def out(d) -> dict:
    return {
        "id": d.id, "mac": d.mac, "ip": d.ip, "status": d.status, "replaced": d.replaced,
        "random_mac": d.random_mac, "owners": [o.id for o in d.owners],
        "hint_of_id": d.hint_of_id, "hint_reason": d.hint_reason,
        "first_seen": str(d.first_seen), "last_seen": str(d.last_seen),
    }  # fmt: skip


def main() -> int:
    from app.core.database import SessionLocal
    from app.models.lock import Device, Override
    from app.models.user import User, UserRole

    cmd, *a = sys.argv[1:]
    with SessionLocal() as db:
        if cmd == "kid":
            k = db.query(User).filter(User.full_name == a[0], User.role == UserRole.KID).first()
            if not k:
                from app.api.kids import KidCreate, create_kid

                return print(json.dumps(create_kid(KidCreate(full_name=a[0]), db))) or 0
            return print(json.dumps({"id": k.id, "full_name": k.full_name})) or 0
        mac = lab_mac(a[0])
        rows = db.query(Device).filter(Device.mac == mac).all()
        if cmd == "dev":
            print(json.dumps([out(d) for d in rows]))
        elif cmd == "assign":
            kid = db.query(User).filter(User.id == int(a[1]), User.role == UserRole.KID).one()
            d = rows[0]
            d.owners, d.status = [kid], "assigned"
            db.commit()
            print(json.dumps(out(d)))
        elif cmd == "purge":
            for d in rows:
                db.query(Override).filter(Override.device_id == d.id).delete()
                db.query(Device).filter(Device.hint_of_id == d.id).update({"hint_of_id": None})
                db.delete(d)
            db.commit()
            print(json.dumps({"purged": len(rows)}))
        return 0


if __name__ == "__main__":
    sys.exit(main())
