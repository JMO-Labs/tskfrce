"""Seed a realistic family; run inside the backend container:
docker compose exec -T backend python - < perf/seed.py
Prints one JSON line: tokens, submitted run ids, a kid-owned device MAC."""

import json
import random
from datetime import UTC, date, datetime, timedelta

from app.core.auth import AuthService
from app.core.database import SessionLocal, _import_all_models
from app.models.chores import Chore, ChoreAssignment, ChoreRun
from app.models.device_activity import DeviceEvent
from app.models.family import get_family
from app.models.lock import Device
from app.models.user import User, UserRole
from app.services import chores as svc
from app.services.chore_types import other_id

random.seed(7)
_import_all_models()
db = SessionLocal()
auth = AuthService(db)
pw = auth.get_password_hash("pw-12345")
fam = get_family(db)
fam.name, fam.setup_step = "Bench Family", None


def user(name, role):
    u = User(
        username=name,
        email=f"{name}@family.local",
        hashed_password=pw,
        role=role,
        full_name=name.title(),
        is_active=True,
    )
    db.add(u)
    return u


parent = user("bench_mom", UserRole.PARENT)
kids = [user(f"bench_kid{i}", UserRole.KID) for i in range(3)]
db.flush()
fam.owner_id = parent.id

for i in range(10):
    d = Device(
        mac=f"02:00:00:00:00:{i + 1:02x}",
        name=f"Device {i}",
        status="assigned",
        last_seen=datetime.utcnow(),
        ip=f"192.168.1.{20 + i}",
    )
    d.owners = [kids[i % 3]]
    db.add(d)
db.flush()
# the blocker also reports the harness containers as devices; keep only ours
devs = db.query(Device).filter(Device.mac.like("02:00:00:00:00:%")).order_by(Device.id).all()

for i in range(20):
    c = Chore(
        title=f"Chore {i}",
        points=random.choice([5, 10, 15, 25]),
        created_by_id=parent.id,
        type_id=other_id(db),
    )
    a = ChoreAssignment(chore=c, mode="each", repeat="daily")
    a.kids = [kids[i % 3], kids[(i + 1) % 3]] if i % 4 == 0 else [kids[i % 3]]
    db.add_all([c, a])
db.flush()

today = svc.today(db)
for back in range(30, -1, -1):
    day = today - timedelta(days=back)
    runs = svc.generate(db, day)
    for r in runs:
        at = datetime.combine(day, datetime.min.time()) + timedelta(hours=random.randint(8, 19))
        if back > 0:
            r.status, r.submitted_at, r.completed_at = "done", at, at
            r.approved_by_id, r.approved_at, r.approved_via = parent.id, at, "parent"
        elif random.random() < 0.4:
            r.status, r.submitted_at, r.submitted_by_id = "submitted", at, r.kid_id
    db.flush()

kinds = ["locked", "unlocked", "locked_try", "sign_in", "outside_hours"]
for d in devs:
    for _ in range(40):
        at = datetime.utcnow() - timedelta(minutes=random.randint(1, 30 * 1440))
        db.add(
            DeviceEvent(
                device_id=d.id, kind=random.choice(kinds), at=at, last_at=at, kid_id=d.owners[0].id
            )
        )
db.commit()

exp = timedelta(hours=12)
mk = lambda u: auth.create_access_token(data={"sub": str(u.id)}, expires_delta=exp)
sub = [
    r.id for r in db.query(ChoreRun).filter(ChoreRun.status == "submitted", ChoreRun.day == today)
]
print(
    json.dumps(
        {
            "parent_token": mk(parent),
            "kid_token": mk(kids[0]),
            "submitted_runs": sub,
            "device_mac": devs[0].mac,
            "device_id": devs[0].id,
        }
    )
)
