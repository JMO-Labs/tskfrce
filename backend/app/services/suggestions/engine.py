"""Rank, filter and persist suggestion state."""

from datetime import datetime

from sqlalchemy.orm import Session

from app.models.suggestion import SuggestionState
from app.services.suggestions.rules import RULES, SYSTEM_RULES

MAX_SHOWN = 3
FAMILY = 1
HIDDEN_KEY = "__hidden__"
MUTABLE_RULES = frozenset(r for r in RULES if r not in SYSTEM_RULES)


def _row(db: Session, key: str) -> SuggestionState | None:
    return db.query(SuggestionState).filter_by(family_id=FAMILY, key=key).first()


def _upsert(db: Session, key: str, fingerprint: str | None, muted: bool) -> None:
    row = _row(db, key)
    if row is None:
        row = SuggestionState(family_id=FAMILY, key=key)
        db.add(row)
    row.fingerprint, row.muted, row.at = fingerprint, muted, datetime.utcnow()
    db.commit()


def is_hidden(db: Session) -> bool:
    row = _row(db, HIDDEN_KEY)
    return bool(row and row.muted)


def suggestions(db: Session, now: datetime | None = None) -> dict:
    """Up to three live suggestions: system > kid-impacting > growth, then newest."""
    if is_hidden(db):
        return {"hidden": True, "items": []}
    now = now or datetime.utcnow()
    state = db.query(SuggestionState).filter_by(family_id=FAMILY).all()
    muted = {s.key for s in state if s.muted}
    dismissed = {s.key: s.fingerprint for s in state if not s.muted}
    found = []
    for rule, fn in RULES.items():
        if rule in muted:
            continue
        found += [s for s in fn(db, now) if dismissed.get(s["key"], None) != s["fingerprint"]]
    found.sort(key=lambda s: s["at"], reverse=True)
    found.sort(key=lambda s: s["tier"])
    items = [{**s, "at": s["at"].isoformat() + "Z"} for s in found[:MAX_SHOWN]]
    return {"hidden": False, "items": items}


def dismiss(db: Session, key: str, fingerprint: str) -> None:
    _upsert(db, key, fingerprint, False)


def mute(db: Session, rule: str) -> None:
    _upsert(db, rule, None, True)


def hide(db: Session) -> None:
    _upsert(db, HIDDEN_KEY, None, True)


def show(db: Session) -> None:
    db.query(SuggestionState).filter_by(family_id=FAMILY, key=HIDDEN_KEY).delete()
    db.commit()


def reset_muted(db: Session) -> None:
    """Un-mute every rule (the hide toggle and per-item dismissals are untouched)."""
    (
        db.query(SuggestionState)
        .filter(
            SuggestionState.family_id == FAMILY,
            SuggestionState.muted.is_(True),
            SuggestionState.key != HIDDEN_KEY,
        )
        .delete()
    )
    db.commit()
