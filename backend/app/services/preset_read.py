"""Preset-managed settings: what is set now, and whether a parent edited it."""

from sqlalchemy.orm import Session

from app.models.chores import Chore, ChoreAssignment
from app.models.family import get_family
from app.models.hours import HourRule
from app.models.screen_time import ScreenTimeLimit
from app.models.user import User
from app.services.presets import STARTERS

KID_KEYS = ("chores", "screen", "bedtime", "lock", "trust", "photo")
FAMILY_KEYS = ("banked", "goals", "penalties")

# What a family that never touched presets has.
DEFAULT = {
    "chores": [],
    "screen": None,
    "bedtime": None,
    "lock": True,
    "trust": False,
    "photo": False,
    "banked": True,
    "goals": True,
    "penalties": False,
}


def starter_chores(db: Session, kid: User) -> list[Chore]:
    """Starter-titled chores with an active assignment that includes the kid."""
    q = (
        db.query(Chore)
        .join(ChoreAssignment, ChoreAssignment.chore_id == Chore.id)
        .filter(Chore.title.in_(list(STARTERS)), ChoreAssignment.active.is_(True))
        .order_by(Chore.id)
    )
    seen, out = set(), []
    for c in q:
        if c.id in seen:
            continue
        if any(a.active and kid in a.kids for a in c.assignments):
            seen.add(c.id)
            out.append(c)
    return out


def allowed_rules(db: Session, kid: User, category: str) -> list[HourRule]:
    """Dateless allowed rules of a category that cover the kid; a rule naming the kid first."""
    rules = [
        r
        for r in db.query(HourRule)
        .filter(
            HourRule.category == category,
            HourRule.kind == "allowed",
            HourRule.start_date.is_(None),
            HourRule.end_date.is_(None),
        )
        .order_by(HourRule.id)
        if r.everyone or kid.id in r.kid_ids
    ]
    return sorted(rules, key=lambda r: r.everyone)


def _end(db: Session, kid: User, category: str) -> str | None:
    rules = allowed_rules(db, kid, category)
    return rules[0].times[-1].end if rules and rules[0].times else None


def current(db: Session, kid: User) -> dict:
    lim = db.get(ScreenTimeLimit, kid.id)
    return {
        "chores": sorted(c.title for c in starter_chores(db, kid)),
        "screen": lim.max_minutes if lim else None,
        "bedtime": _end(db, kid, "school_night"),
        "weekend": _end(db, kid, "weekend"),
        "lock": bool(kid.chores_lock),
        "trust": bool(kid.trust_mode),
        "photo": any(c.needs_photo for c in starter_chores(db, kid)),
    }


def family_current(db: Session) -> dict:
    fam = get_family(db)
    return {
        "banked": bool(fam.screen_rollover),
        "goals": bool(fam.goals_on),
        "penalties": bool(fam.penalties_enabled),
    }


def edited(key: str, now, base: dict):
    """A key is an edit when it differs from what a preset last wrote; with no stored value,
    when it is not the app default."""
    return now != (base[key] if key in base else DEFAULT[key])
