"""Setup presets: work out what a style changes and apply it, keeping parents' edits."""

import json

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.lock import loop
from app.models.family import get_family
from app.models.user import User, UserRole
from app.services import presets
from app.services.preset_read import (  # noqa: F401  (re-exported)
    DEFAULT,
    FAMILY_KEYS,
    KID_KEYS,
    current,
    edited,
    family_current,
)
from app.services.preset_write import bedtime_all, write  # noqa: F401  (re-exported)

NO_KID = "That kid doesn't exist. Pick a kid from the list."


def kids(db: Session) -> list[User]:
    return db.query(User).filter(User.role == UserRole.KID, User.is_active).order_by(User.id).all()


def plan(db: Session, body: dict):
    """(scope, targets). scope: {"family": bool, "style": str}; targets: [(kid, style)]."""
    fam = get_family(db)
    listed = {int(k): v for k, v in (body.get("kids") or {}).items()}
    all_kids = kids(db)
    if set(listed) - {k.id for k in all_kids}:
        raise HTTPException(404, NO_KID)
    style = body.get("style")
    fstyle = style or fam.preset_style or "balanced"
    scope = {"family": style is not None, "style": fstyle}
    targets = []
    for k in all_kids:
        if style is None and k.id not in listed:
            continue
        own = listed[k.id] if k.id in listed else k.preset_style
        targets.append((k, own or fstyle))
    return scope, targets


def _save_styles(db: Session, scope: dict, targets: list, body: dict) -> None:
    fam = get_family(db)
    if scope["family"]:
        fam.preset_style = scope["style"]
    listed = {int(k): v for k, v in (body.get("kids") or {}).items()}
    for k, style in targets:
        if k.id in listed:
            k.preset_style = None if listed[k.id] in (None, scope["style"]) else listed[k.id]


def run(db: Session, parent: User, body: dict, write_it: bool) -> dict:
    """Preview (write_it False) or apply a style. Edited, skipped or unchanged keys are not written."""
    scope, targets = plan(db, body)
    fam = get_family(db)
    skip = set(body.get("skip") or [])
    saved = json.loads(fam.preset_base) if fam.preset_base else {}
    base = {"family": saved.get("family", {}), "kids": saved.get("kids", {})}
    changes, kept = [], []
    new_base = {
        "family": dict(base["family"]),
        "kids": {k: dict(v) for k, v in base["kids"].items()},
    }
    plans = {k.id: presets.kid_plan(k.age_group or "kid", style) for k, style in targets}
    todo = []  # (kid or None, key, value)

    def consider(kid, key, now, nxt, b, bucket):
        row = {
            "kid_id": kid.id if kid else None,
            "who": (kid.full_name or kid.username) if kid else None,
        }
        row |= {"key": key, "now": now, "next": nxt}
        bucket[key] = nxt
        if key in skip or now == nxt:
            return
        if edited(key, now, b):
            kept.append(row)
        else:
            changes.append(row)
            todo.append((kid, key, nxt))

    if scope["family"]:
        fplan, fnow = presets.family_plan(scope["style"]), family_current(db)
        for key in FAMILY_KEYS:
            consider(None, key, fnow[key], fplan[key], base["family"], new_base["family"])
    for kid, _style in targets:
        p, now = plans[kid.id], current(db, kid)
        b, nb = base["kids"].get(str(kid.id), {}), new_base["kids"].setdefault(str(kid.id), {})
        for key in KID_KEYS:
            nxt = sorted(p[key]) if key == "chores" else p[key]
            consider(kid, key, now[key], nxt, b, nb)
    if write_it:
        # kids outside the scope still share chores: their saved style decides a shared photo rule
        fstyle = fam.preset_style or "balanced"
        others = {
            k.id: presets.kid_plan(k.age_group or "kid", k.preset_style or fstyle) for k in kids(db)
        }
        _apply(db, parent, todo, others | plans, targets)
        _save_styles(db, scope, targets, body)
        fam.preset_base = json.dumps(new_base)
        db.commit()
        loop.trigger()
    return {
        "style": scope["style"],
        "kids": [
            {"id": k.id, "name": k.full_name or k.username, "age_group": k.age_group, "style": s}
            for k, s in targets
        ],
        "changes": changes,
        "kept": kept,
    }


def _apply(db: Session, parent: User, todo: list, plans: dict, targets: list) -> None:
    by_id = {k.id: k for k, _ in targets}
    bed = [kid.id for kid, key, _ in todo if key == "bedtime" and kid]
    covered = bedtime_all(db, {i: plans[i] for i in bed}) if len(bed) == len(kids(db)) else set()
    for kid, key, value in todo:
        if key == "bedtime" and kid.id in covered:
            continue
        write(db, parent, kid and by_id[kid.id], key, value, plans)
