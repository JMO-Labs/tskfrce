"""Penalties: points taken, saved screen time docked, or devices blocked (give side)."""

import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.chores import Chore, ChoreAssignment, ChoreRun
from app.models.family import FamilySettings, get_family
from app.models.lock import Device, DeviceGroup, Override
from app.models.penalty import Penalty
from app.models.user import User
from app.schemas.lock import utc_z
from app.services import chore_types, chores, economy, inbox, screen_bank

DEFAULT_SIZES = {
    "small": {"kind": "points", "amount": 20, "earn_back": "all"},
    "medium": {"kind": "block", "amount": 1440, "earn_back": "half"},
    "big": {"kind": "block", "amount": 4320, "earn_back": "half"},
}
DEFAULT_MAKEUP = [
    "Wipe the kitchen counters",
    "Sweep the kitchen",
    "Fold a load of laundry",
    "Tidy the living room",
]
SHARES = {"none": (0, 1), "half": (1, 2), "all": (1, 1)}
MAKEUP_DAYS = 7


def sizes(fam: FamilySettings) -> dict:
    return json.loads(fam.penalty_sizes) if fam.penalty_sizes else DEFAULT_SIZES


def makeup_list(fam: FamilySettings) -> list[str]:
    return json.loads(fam.makeup_chores) if fam.makeup_chores else list(DEFAULT_MAKEUP)


@dataclass
class Give:
    kind: str
    amount: int
    earn_back: str
    reason: str | None = None
    device_id: int | None = None
    group_id: int | None = None
    makeup: list[str] | None = None
    chore_run_id: int | None = None
    notification_id: int | None = None


def _naive(now: datetime) -> datetime:
    return now.astimezone(UTC).replace(tzinfo=None) if now.tzinfo else now


def _aware(now: datetime) -> datetime:
    return now if now.tzinfo else now.replace(tzinfo=UTC)


def target_devices(db: Session, kid: User, g: Give) -> tuple[list[Device], str]:
    """Devices a block hits, plus its label. Neither device nor group: the kid's non-exempt devices."""
    if g.device_id is not None:
        d = db.get(Device, g.device_id)
        if d is None:
            raise HTTPException(404, "Device not found.")
        return [d], d.name
    if g.group_id is not None:
        grp = db.get(DeviceGroup, g.group_id)
        if grp is None:
            raise HTTPException(404, "Group not found.")
        return [d for d in grp.devices if kid in d.owners], grp.name
    return [d for d in kid.devices if not d.exempt], "devices"


def recent_count(db: Session, kid_id: int, now: datetime) -> int:
    since = _naive(now) - timedelta(days=7)
    return (
        db.query(Penalty)
        .filter(
            Penalty.kid_id == kid_id, Penalty.created_at >= since, Penalty.status != "cancelled"
        )
        .count()
    )


def _plural(n: int, word: str) -> str:
    return f"{n} {word}" + ("" if n == 1 else "s")


def _duration(minutes: int) -> str:
    days, rest = divmod(minutes, 1440)
    hours, mins = divmod(rest, 60)
    parts = [_plural(days, "day")] if days else []
    if hours:
        parts.append(_plural(hours, "hour"))
    if mins or not parts:
        parts.append(f"{mins} min")
    return " ".join(parts)


def summary(p: Penalty) -> str:
    if p.kind == "points":
        return f"{p.amount} points"
    if p.kind == "screen":
        return f"{p.amount} min of saved screen time"
    return f"No {p.label or 'devices'}, {_duration(p.amount)}"


def _makeup_runs(db: Session, kid: User, p: Penalty, titles: list[str], by: User, now) -> None:
    day = chores.today(db, now)
    for title in titles:
        chore = Chore(
            title=title,
            points=0,
            makeup=True,
            created_by_id=by.id,
            type_id=chore_types.other_id(db),
        )
        a = ChoreAssignment(chore=chore, mode="each", repeat="once", on_date=day)
        a.kids = [kid]
        db.add_all([chore, a])
        db.flush()
        db.add(ChoreRun(assignment_id=a.id, day=day, kid_id=kid.id, penalty_id=p.id))


def _give_one(db: Session, kid: User, g: Give, by: User, now: datetime, group: str | None):
    fam = get_family(db)
    created = _naive(now)
    p = Penalty(
        kid_id=kid.id,
        group_id=group,
        kind=g.kind,
        amount=g.amount,
        earn_back=g.earn_back,
        reason=g.reason,
        chore_run_id=g.chore_run_id,
        notification_id=g.notification_id,
        given_by_id=by.id,
        created_at=created,
    )
    db.add(p)
    db.flush()
    if g.kind == "points":
        note = f"Penalty: {g.reason}" if g.reason else "Penalty"
        p.amount_taken = economy.deduct(
            db, kid.id, g.amount, note, by.id, reason="penalty", penalty_id=p.id, notify=False
        )
    elif g.kind == "screen":
        p.amount_taken = screen_bank.take(db, fam, kid.id, g.amount)
    else:
        devs, p.label = target_devices(db, kid, g)
        p.ends_at = created + timedelta(minutes=g.amount)
        p.amount_taken = g.amount if devs else 0
        if g.device_id is None and g.group_id is None:
            p.all_devices = True  # the lock covers any non-exempt device, now or later
        else:
            p.device_ids = json.dumps([d.id for d in devs])
            for d in devs:
                db.add(
                    Override(
                        device_id=d.id,
                        action="lock",
                        source="penalty",
                        expires_at=p.ends_at,
                        created_by_id=by.id,
                        penalty_id=p.id,
                    )
                )
    if g.kind != "block":
        num, den = SHARES[g.earn_back]
        p.back_total = p.amount_taken * num // den
        titles = (
            (g.makeup if g.makeup is not None else makeup_list(fam)[:2]) if p.back_total else []
        )
        p.makeup_count = len(titles)
        if titles:
            p.ends_at = created + timedelta(days=MAKEUP_DAYS)
            _makeup_runs(db, kid, p, titles, by, _aware(now))
        else:
            p.status, p.ended_at = "ended", created
    body = summary(p) + (f" · {g.reason}" if g.reason else "")
    inbox.notify(db, [kid.id], "points_taken", f"{by.full_name} gave you a penalty", body)
    return p


def give(db: Session, kid_ids: list[int], g: Give, by: User, now: datetime) -> list[Penalty]:
    """One penalty per kid (shared group_id when several). Commits."""
    group = uuid4().hex if len(kid_ids) > 1 else None
    with economy.SPEND_LOCK:
        db.commit()  # fresh snapshot for the balance and bank reads
        kids = [db.get(User, k) for k in kid_ids]
        out_rows = [_give_one(db, k, g, by, now, group) for k in kids]
        db.commit()
    return out_rows


def out(db: Session, p: Penalty) -> dict:
    by = db.get(User, p.given_by_id) if p.given_by_id else None
    runs = db.query(ChoreRun).filter(ChoreRun.penalty_id == p.id).order_by(ChoreRun.id).all()
    return {
        "id": p.id,
        "kid_id": p.kid_id,
        "group_id": p.group_id,
        "kind": p.kind,
        "amount": p.amount,
        "amount_taken": p.amount_taken,
        "amount_returned": p.amount_returned,
        "back_total": p.back_total,
        "label": p.label,
        "earn_back": p.earn_back,
        "reason": p.reason,
        "given_by": by.full_name if by else None,
        "created_at": utc_z(p.created_at),
        "ends_at": utc_z(p.ends_at),
        "status": p.status,
        "seen_by_kid": p.seen_by_kid,
        "summary": summary(p),
        "makeup": [
            {"run_id": r.id, "title": r.assignment.chore.title, "status": r.status} for r in runs
        ],
    }
