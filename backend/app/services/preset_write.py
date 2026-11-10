"""Preset-managed settings: one writer per key."""

from sqlalchemy.orm import Session

from app.models.chore_type import ChoreType
from app.models.chores import Chore, ChoreAssignment, ChoreRun
from app.models.family import get_family
from app.models.hours import HourRule, HourRuleTarget, HourRuleTime
from app.models.screen_time import ScreenTimeLimit
from app.models.user import User, UserRole
from app.services import chores as svc
from app.services import kid_events, screen_bank
from app.services.preset_read import allowed_rules, starter_chores
from app.services.presets import STARTERS

# category -> (plan key, days, default start, rule name prefix)
BEDTIME = {
    "school_night": ("bedtime", "01236", "07:00", "School nights"),
    "weekend": ("weekend", "45", "08:00", "Weekends"),
}


def _type_id(db: Session, name: str) -> int:
    t = db.query(ChoreType).filter(ChoreType.name == name).first()
    if t is None:
        t = db.query(ChoreType).filter(ChoreType.name == "Other").first()
    return t.id


def _add_chore(db: Session, parent: User, kid: User, title: str) -> None:
    type_name, points, days = STARTERS[title]
    c = db.query(Chore).filter(Chore.title == title).order_by(Chore.id).first()
    if c is None:
        c = Chore(
            title=title, points=points, created_by_id=parent.id, type_id=_type_id(db, type_name)
        )
        db.add(c)
        db.flush()
    a = ChoreAssignment(
        chore_id=c.id,
        mode="each",
        repeat="weekly" if days else "daily",
        days="".join(str(d) for d in days) if days else None,
        active=True,
    )
    a.kids = [kid]
    db.add(a)
    db.flush()
    if get_family(db).setup_step is None:  # wizard chores start at the next reset, quietly
        svc.make_runs(db, a, svc.today(db))
        kid_events.chore_new(db, a)


def _remove_chore(db: Session, kid: User, title: str) -> None:
    for c in db.query(Chore).filter(Chore.title == title):
        for a in list(c.assignments):
            if not a.active or kid not in a.kids:
                continue
            if len(a.kids) == 1:  # only theirs: retire it like deleting an assignment
                runs = db.query(ChoreRun).filter(ChoreRun.assignment_id == a.id).all()
                if not runs:
                    db.delete(a)
                    continue
                a.active, a.kids = False, []
                mine = runs
            else:
                a.kids = [k for k in a.kids if k.id != kid.id]
                if len(a.kids) <= 1:
                    a.mode = "each"
                mine = [
                    r
                    for r in db.query(ChoreRun).filter(
                        ChoreRun.assignment_id == a.id, ChoreRun.kid_id == kid.id
                    )
                ]
            for r in mine:
                if r.status in ("todo", "submitted"):
                    r.status = "cancelled"
    db.flush()


def _chores(db: Session, parent: User, kid: User, value: list) -> None:
    have = {c.title for c in starter_chores(db, kid)}
    for title in value:
        if title not in have:
            _add_chore(db, parent, kid, title)
    for title in have - set(value):
        _remove_chore(db, kid, title)


def _screen(db: Session, kid: User, value) -> None:
    row = db.get(ScreenTimeLimit, kid.id)
    if value is None:
        if row is not None and row.min_points is None:
            db.delete(row)
        elif row is not None:
            row.max_minutes = None
    elif row is None:
        db.add(ScreenTimeLimit(kid_id=kid.id, max_minutes=value))
    else:
        row.max_minutes = value
    db.flush()


def _active_kids(db: Session) -> list[User]:
    return db.query(User).filter(User.role == UserRole.KID).order_by(User.id).all()


def _leave(db: Session, rule: HourRule, kid: User) -> None:
    """Take the kid off a shared rule; a rule left with nobody is deleted."""
    if rule.everyone:
        rule.everyone = False
        rule.targets = [HourRuleTarget(kid_id=k.id) for k in _active_kids(db) if k.id != kid.id]
    else:
        rule.targets = [t for t in rule.targets if t.kid_id != kid.id]
    if not rule.targets:
        db.delete(rule)


def _bedtime_one(db: Session, kid: User, cat: str, end: str) -> None:
    _, days, start, label = BEDTIME[cat]
    rules = allowed_rules(db, kid, cat)
    own = next((r for r in rules if not r.everyone and r.kid_ids == [kid.id]), None)
    if own is not None and own.times:
        own.times[-1].end = end
        return
    if rules and rules[0].times:
        start = rules[0].times[-1].start
    for r in rules:
        _leave(db, r, kid)
    rule = HourRule(name=f"{label} · {kid.full_name}"[:60], category=cat, kind="allowed", days=days)
    rule.times = [HourRuleTime(start=start, end=end)]
    rule.targets = [HourRuleTarget(kid_id=kid.id)]
    db.add(rule)


def bedtime_all(db: Session, kids_targets: dict) -> bool:
    """Fresh family, everyone on the same bedtime: one Everyone rule per category.
    `kids_targets` maps kid id -> plan. Returns False when it does not apply."""
    kids = _active_kids(db)
    plans = [kids_targets.get(k.id) for k in kids]
    if not kids or any(p is None for p in plans):
        return False
    if len({(p["bedtime"], p["weekend"]) for p in plans}) != 1:
        return False
    if (
        db.query(HourRule)
        .filter(HourRule.kind == "allowed", HourRule.category.in_(list(BEDTIME)))
        .first()
    ):
        return False
    for cat, (key, days, start, label) in BEDTIME.items():
        rule = HourRule(name=label, category=cat, kind="allowed", days=days, everyone=True)
        rule.times = [HourRuleTime(start=start, end=plans[0][key])]
        db.add(rule)
    db.flush()
    return True


def _bedtime(db: Session, kid: User, plan: dict) -> None:
    for cat, (key, *_rest) in BEDTIME.items():
        _bedtime_one(db, kid, cat, plan[key])
    db.flush()


def _photo(db: Session, kid: User, value: bool, plans: dict) -> None:
    for c in starter_chores(db, kid):
        if value:
            c.needs_photo = True
            continue
        others = {k.id for a in c.assignments if a.active for k in a.kids} - {kid.id}
        c.needs_photo = any(plans.get(i, {}).get("photo") for i in others)
    db.flush()


def write(db: Session, parent: User, kid: User | None, key: str, value, plans: dict) -> None:
    """Write one preset-managed value. `plans` maps kid id -> that kid's plan."""
    if key == "banked":
        fam = get_family(db)
        fam.screen_rollover = bool(value)
        if not value:
            screen_bank.clear_all(db)
    elif key == "chores":
        _chores(db, parent, kid, value)
    elif key == "screen":
        _screen(db, kid, value)
    elif key == "bedtime":
        _bedtime(db, kid, plans[kid.id])
    elif key == "lock":
        kid.chores_lock = bool(value)
    elif key == "trust":
        if value and not kid.trust_mode:
            kid.trust_clean = 0  # opting in always starts a fresh count
        kid.trust_mode = bool(value)
    elif key == "photo":
        _photo(db, kid, bool(value), plans)
    db.flush()
