"""One function per rule; each returns suggestion dicts built from real state."""

import re
from datetime import datetime, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.chores import ChoreAssignment, ChoreRun
from app.models.family import get_family
from app.models.goal import Goal, GoalContribution
from app.models.homework import HomeworkRequest
from app.models.lock import Device
from app.models.user import User, UserRole

SYSTEM, KID, GROWTH = 0, 1, 2
SETUP_DAYS = 7
SKIP_RUN = 3
CRUISE_DAYS = 5
STALE_DAYS = 7
GOAL_IDLE_DAYS = 14
CLOSE_DAYS = 3
HOMEWORK_RE = re.compile(r"homework|school|study|reading", re.I)


def _name(u: User) -> str:
    return u.full_name or u.username


def _kids(db: Session) -> list[User]:
    return (
        db.query(User)
        .filter(User.role == UserRole.KID, User.is_active.is_(True))
        .order_by(User.id)
        .all()
    )


def _s(rule, subject, tier, fp, at, title, body, kind, label, to) -> dict:
    return {
        "key": f"{rule}:{subject}" if subject else rule,
        "rule": rule,
        "tier": tier,
        "fingerprint": str(fp),
        "at": at,
        "title": title,
        "body": body,
        "action": {"kind": kind, "label": label, "to": to},
    }


def _day_at(d) -> datetime:
    return datetime(d.year, d.month, d.day)


def chore_skipped(db: Session, now: datetime) -> list[dict]:
    today = now.date()
    runs = (
        db.query(ChoreRun)
        .filter(ChoreRun.kid_id.isnot(None), ChoreRun.day <= today)
        .order_by(ChoreRun.assignment_id, ChoreRun.kid_id, ChoreRun.day.desc())
        .all()
    )
    groups: dict[tuple[int, int], list[ChoreRun]] = {}
    for r in runs:
        groups.setdefault((r.assignment_id, r.kid_id), []).append(r)
    out = []
    for (aid, kid_id), rs in groups.items():
        last = rs[:SKIP_RUN]
        if len(last) < SKIP_RUN or any(r.status not in ("skipped", "missed") for r in last):
            continue
        a = db.get(ChoreAssignment, aid)
        if a is None or not a.active:
            continue
        kid = db.get(User, kid_id)
        out.append(
            _s(
                "chore.skipped",
                f"{aid}:{kid_id}",
                KID,
                last[0].day.isoformat(),
                _day_at(last[0].day),
                f"{a.chore.title} keeps getting skipped",
                f"{_name(kid)} skipped {a.chore.title} {SKIP_RUN} times in a row. "
                "Try a different time or add a photo step.",
                "link",
                "Open chore",
                "/chores",
            )
        )
    return out


def chore_stale(db: Session, now: datetime) -> list[dict]:
    cutoff = now - timedelta(days=STALE_DAYS)
    out = []
    for a in db.query(ChoreAssignment).filter(ChoreAssignment.active.is_(True)).all():
        if a.repeat == "once" or not a.kids or (a.created_at or now) > cutoff:
            continue
        last = (
            db.query(func.max(ChoreRun.day))
            .filter(ChoreRun.assignment_id == a.id, ChoreRun.status == "done")
            .scalar()
        )
        if last is not None and last >= cutoff.date():
            continue
        out.append(
            _s(
                "chore.stale",
                a.id,
                KID,
                last.isoformat() if last else "never",
                (a.created_at or now) + timedelta(days=STALE_DAYS),
                f"Nobody has done {a.chore.title} in {STALE_DAYS} days",
                f"{a.chore.title} is assigned but hasn't been done this week. "
                "Edit it or archive it.",
                "link",
                "Edit chore",
                "/chores",
            )
        )
    return out


def kid_cruising(db: Session, now: datetime) -> list[dict]:
    today = now.date()
    out = []
    for kid in _kids(db):
        by_day: dict = {}
        for r in db.query(ChoreRun).filter(
            ChoreRun.kid_id == kid.id,
            ChoreRun.day >= today - timedelta(days=CRUISE_DAYS),
            ChoreRun.day < today,
        ):
            by_day.setdefault(r.day, []).append(r.status)
        if len(by_day) < CRUISE_DAYS or any(s != "done" for v in by_day.values() for s in v):
            continue
        last = max(by_day)
        out.append(
            _s(
                "kid.cruising",
                kid.id,
                GROWTH,
                last.isoformat(),
                _day_at(last),
                f"{_name(kid)} is on a roll",
                f"{_name(kid)} finished every chore for {CRUISE_DAYS} days. "
                "Time for harder chores or more points?",
                "link",
                "Open chores",
                "/chores",
            )
        )
    return out


def goal_close(db: Session, now: datetime) -> list[dict]:
    week = now - timedelta(days=7)
    out = []
    for g in db.query(Goal).filter(Goal.status == "active", Goal.kid_id.isnot(None)):
        if not g.target:
            continue
        cs = db.query(GoalContribution).filter(GoalContribution.goal_id == g.id).all()
        saved = sum(c.amount for c in cs)
        earned = sum(c.amount for c in cs if c.amount > 0 and c.created_at >= week)
        left = g.target - saved
        if left <= 0 or earned <= 0 or left / (earned / 7) > CLOSE_DAYS:
            continue
        kid = db.get(User, g.kid_id)
        out.append(
            _s(
                "goal.close",
                g.id,
                KID,
                f"{g.id}:{g.target}",
                now,
                f"{g.name} is almost there",
                f"{_name(kid)} is about {max(1, round(left / (earned / 7)))} day(s) from "
                f"{g.name}. Send a cheer.",
                "link",
                "Send cheer",
                "/goals",
            )
        )
    return out


def goal_missing(db: Session, now: datetime) -> list[dict]:
    if not get_family(db).goals_on:
        return []
    setup, idle = now - timedelta(days=SETUP_DAYS), now - timedelta(days=GOAL_IDLE_DAYS)
    out = []
    for kid in _kids(db):
        if (kid.created_at or now) > setup:
            continue
        goals = db.query(Goal).filter(Goal.kid_id == kid.id, Goal.status == "active").all()
        if not goals:
            out.append(
                _s(
                    "goal.missing",
                    kid.id,
                    KID,
                    "none",
                    kid.created_at + timedelta(days=7),
                    f"{_name(kid)} has no goal",
                    f"{_name(kid)} isn't saving for anything yet. A goal makes chores matter.",
                    "link",
                    "Add goal",
                    f"/goals?kid={kid.id}",
                )
            )
            continue
        stalled = [
            g
            for g in goals
            if g.created_at <= idle
            and not db.query(GoalContribution)
            .filter(GoalContribution.goal_id == g.id, GoalContribution.created_at >= idle)
            .count()
        ]
        if len(stalled) == len(goals):
            g = stalled[0]
            out.append(
                _s(
                    "goal.missing",
                    kid.id,
                    KID,
                    f"stalled:{g.id}",
                    g.created_at + timedelta(days=GOAL_IDLE_DAYS),
                    f"{g.name} has stalled",
                    f"{_name(kid)} hasn't added to {g.name} in {GOAL_IDLE_DAYS} days. "
                    "Refresh it or set a new goal.",
                    "link",
                    "Add goal",
                    f"/goals?kid={kid.id}",
                )
            )
    return out


def family_parent(db: Session, now: datetime) -> list[dict]:
    parents = db.query(User).filter(User.role == UserRole.PARENT, User.is_active.is_(True)).all()
    if len(parents) != 1:
        return []
    since = parents[0].created_at or now
    if since > now - timedelta(days=SETUP_DAYS):
        return []
    return [
        _s(
            "family.parent",
            None,
            GROWTH,
            "1",
            since + timedelta(days=SETUP_DAYS),
            "Invite another parent",
            "Only one parent can approve chores right now. Invite a second so "
            "approvals don't wait on one phone.",
            "link",
            "Invite parent",
            "/settings",
        )
    ]


def devices_unknown(db: Session, now: datetime) -> list[dict]:
    devs = db.query(Device).filter(Device.status == "unassigned").order_by(Device.id).all()
    if not devs:
        return []
    more = f" and {len(devs) - 2} more" if len(devs) > 2 else ""
    names = ", ".join(d.name for d in devs[:2]) + more
    return [
        _s(
            "devices.unknown",
            None,
            SYSTEM,
            f"{len(devs)}:{devs[-1].id}",
            max(d.first_seen or now for d in devs),
            "New devices on your network",
            f"{names} joined and isn't assigned to anyone yet."
            if len(devs) == 1
            else f"{names} joined and aren't assigned to anyone yet.",
            "link",
            "Who's this?",
            "/devices",
        )
    ]


def feature_homework(db: Session, now: datetime) -> list[dict]:
    out = []
    for kid in _kids(db):
        if db.query(HomeworkRequest).filter(HomeworkRequest.kid_id == kid.id).count():
            continue
        titles = [
            a.chore.title
            for a in db.query(ChoreAssignment).filter(ChoreAssignment.active.is_(True))
            if kid in a.kids and HOMEWORK_RE.search(a.chore.title)
        ]
        if titles:
            out.append(
                _s(
                    "feature.homework",
                    kid.id,
                    GROWTH,
                    "unused",
                    now,
                    "Try homework mode",
                    f"{_name(kid)} has {titles[0]} on the list. Homework mode opens only "
                    "the sites school needs, for tonight.",
                    "link",
                    "Open homework",
                    "/homework",
                )
            )
    return out


RULES = {
    "chore.skipped": chore_skipped,
    "chore.stale": chore_stale,
    "kid.cruising": kid_cruising,
    "goal.close": goal_close,
    "goal.missing": goal_missing,
    "family.parent": family_parent,
    "devices.unknown": devices_unknown,
    "feature.homework": feature_homework,
}
SYSTEM_RULES = frozenset({"devices.unknown"})
