"""Parent API: browse the catalog, install, configure, remove and audit integrations."""

import json
import uuid
from datetime import UTC, datetime
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session, aliased

from app.api.deps import get_db, require_parent
from app.integrations import catalog, store
from app.integrations.client import BoxClient, InstallCtx, ProtocolError
from app.integrations.manifest import Manifest, load_manifest
from app.integrations.net import BlockedError, FetchError
from app.integrations.permissions import PERMS
from app.integrations.protocol import grant_out
from app.models.chores import Chore
from app.models.integration import (
    IntegrationAction,
    IntegrationChore,
    IntegrationInstall,
    IntegrationKid,
)
from app.models.user import User, UserRole
from app.schemas.integration import InstallIn, InstallPatch
from app.schemas.lock import utc_z
from app.services.chat_extras import first_name

router = APIRouter(
    prefix="/api/v1/integrations", tags=["integrations"], dependencies=[Depends(require_parent)]
)
LIVE = ("active", "paused")


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _perms(ids) -> list[dict]:
    return [{"id": p, "text": PERMS[p].text, "high_risk": PERMS[p].high_risk} for p in ids]


def _domain(m: Manifest) -> str:
    return urlsplit(m.base_url).hostname or ""


def _live_ids(db: Session) -> set[str]:
    rows = db.query(IntegrationInstall.integration_id).filter(IntegrationInstall.status.in_(LIVE))
    return {i for (i,) in rows if i}


def _catalog() -> catalog.Catalog:
    cat = catalog.cached()
    if cat is None:
        raise HTTPException(503, "We couldn't load the list yet. Try again in a minute.")
    return cat


@router.get("/catalog")
def list_catalog(db: Session = Depends(get_db)):
    cat, live = _catalog(), _live_ids(db)
    return [
        {
            "id": m.id,
            "name": m.name,
            "developer": m.developer,
            "description": m.description,
            "icon": m.icon,
            "version": m.version,
            "domain": _domain(m),
            "settings": [f.model_dump() for f in m.settings],
            "permissions": _perms(m.permissions),
            "widgets": [w.model_dump() for w in m.widgets],
            "installed": m.id in live,
        }
        for iid, (m, _env) in sorted(cat.manifests.items())
        if iid not in cat.revoked
    ]


def _check_settings(m: Manifest, given: dict) -> tuple[dict, dict]:
    """(everything to send in install, the non-secret part to keep). 422 on a bad value."""
    sent, kept = {}, {}
    for f in m.settings:
        v = given.get(f.key)
        if v is None or v == "":
            if f.required:
                raise HTTPException(422, f"{f.label} is required")
            continue
        if f.type == "number":
            try:
                v = int(v)
            except ValueError:
                raise HTTPException(422, f"{f.label} must be a number") from None
        else:
            v = str(v)
            if f.type == "select" and v not in f.options:
                raise HTTPException(422, f"{f.label} isn't one of the choices")
        sent[f.key] = v
        if not f.secret:
            kept[f.key] = v
    return sent, kept


def _kids(db: Session, ids: set[int]) -> list[User]:
    kids = db.query(User).filter(User.id.in_(ids), User.role == UserRole.KID).order_by(User.id)
    kids = kids.all()
    if len(kids) != len(ids):
        raise HTTPException(422, "Pick kids from your family.")
    return kids


def _chores(db: Session, ids: set[int]) -> list[Chore]:
    chores = db.query(Chore).filter(Chore.id.in_(ids)).order_by(Chore.id).all()
    if len(chores) != len(ids):
        raise HTTPException(422, "Pick chores from your list.")
    return chores


def _check_kid_widgets(perms, kid_widget_ids: set[int], kid_ids) -> None:
    if kid_widget_ids and "widgets.kid" not in perms:
        raise HTTPException(422, "This one can't show cards on kids' screens.")
    if not kid_widget_ids <= set(kid_ids):
        raise HTTPException(422, "Pick from the linked kids.")


@router.post("", status_code=201)
def install(body: InstallIn, db: Session = Depends(get_db), user: User = Depends(require_parent)):
    cat = _catalog()
    entry = cat.manifests.get(body.integration_id)
    if entry is None or body.integration_id in cat.revoked:
        raise HTTPException(404, "That integration isn't available.")
    m, env = entry
    if m.id in _live_ids(db):
        raise HTTPException(409, "That's already connected.")
    if set(body.accepted_permissions) != set(m.permissions):
        raise HTTPException(409, "The permissions changed. Look them over again.")
    sent, kept = _check_settings(m, body.settings)
    kids, chores = _kids(db, set(body.kid_ids)), _chores(db, set(body.chore_ids))
    kid_widgets = set(body.kid_widget_ids)
    _check_kid_widgets(m.permissions, kid_widgets, body.kid_ids)

    public_id, secret = uuid.uuid4().hex, store.new_secret()
    out = grant_out(
        m.permissions, [(k.id, first_name(k)) for k in kids], [(c.id, c.title) for c in chores]
    )
    client = BoxClient(InstallCtx(public_id, m.base_url, secret, out), transport=store._transport)
    try:  # before any write, so no SQLite write lock is held; the reply's actions are ignored
        client.install(sent)
    except (ProtocolError, FetchError, BlockedError):
        raise HTTPException(502, f"{m.name} didn't answer. Nothing was connected.") from None

    now = _now()
    row = IntegrationInstall(
        public_id=public_id,
        source="catalog",
        integration_id=m.id,
        name=m.name,
        icon=m.icon,
        manifest=json.dumps(env),
        settings=json.dumps(kept),
        permissions=json.dumps(m.permissions),
        secret=store.seal_secret(secret),
        status="active",
        next_poll_at=now if m.poll_seconds else None,
        created_at=now,
        created_by_id=user.id,
    )
    row.kids = [IntegrationKid(kid_id=k.id, kid_widgets=k.id in kid_widgets) for k in kids]
    row.chores = [IntegrationChore(chore_id=c.id) for c in chores]
    db.add(row)
    db.commit()
    return _out(row)


def _out(i: IntegrationInstall) -> dict:
    return {
        "id": i.id,
        "source": i.source,
        "integration_id": i.integration_id,
        "name": i.name,
        "icon": i.icon,
        "status": i.status,
        "paused_reason": i.paused_reason,
        "trusted": bool(i.trusted),
        "kid_ids": sorted(k.kid_id for k in i.kids),
        "key_prefix": i.key_prefix,
        "created_at": utc_z(i.created_at),
    }


def _get(db: Session, install_id: int) -> IntegrationInstall:
    i = db.get(IntegrationInstall, install_id)
    if i is None or i.status == "removed":
        raise HTTPException(404, "That integration isn't connected.")
    return i


@router.get("")
def list_installs(db: Session = Depends(get_db)):
    rows = db.query(IntegrationInstall).filter(IntegrationInstall.status != "removed")
    return [_out(i) for i in rows.order_by(IntegrationInstall.id)]


@router.get("/{install_id}")
def detail(install_id: int, db: Session = Depends(get_db)):
    i = _get(db, install_id)
    m = load_manifest(json.loads(i.manifest)) if i.manifest else None
    widgets = {k.kid_id: k.kid_widgets for k in i.kids}
    kids = db.query(User).filter(User.id.in_(widgets)).order_by(User.id).all()
    chore_ids = [c.chore_id for c in i.chores]
    chores = db.query(Chore).filter(Chore.id.in_(chore_ids)).order_by(Chore.id).all()
    return {
        **_out(i),
        "permissions": _perms(json.loads(i.permissions)),
        "kids": [{"id": k.id, "name": first_name(k), "kid_widgets": widgets[k.id]} for k in kids],
        "chores": [{"id": c.id, "title": c.title} for c in chores],
        "settings": json.loads(i.settings) if i.settings else {},
        "domain": _domain(m) if m else None,
        "developer": m.developer if m else None,
    }


@router.patch("/{install_id}")
def patch(install_id: int, body: InstallPatch, db: Session = Depends(get_db)):
    i = _get(db, install_id)
    if i.status == "revoked":
        raise HTTPException(409, "t@sk4ce turned this one off.")
    if body.kid_widget_ids is not None:
        want = set(body.kid_widget_ids)
        _check_kid_widgets(json.loads(i.permissions), want, [k.kid_id for k in i.kids])
        for k in i.kids:
            k.kid_widgets = k.kid_id in want
    if body.trusted is not None:
        i.trusted = body.trusted
    if body.resume and i.status == "paused":
        i.status, i.failures, i.paused_reason = "active", 0, None
    db.commit()
    from app.integrations import widget_service  # grant or status may have changed

    widget_service.forget(i.id)
    return _out(i)


@router.delete("/{install_id}", status_code=204)
def remove(install_id: int, db: Session = Depends(get_db)):
    store.remove(db, _get(db, install_id), _now())
    db.commit()
    return Response(status_code=204)


@router.get("/{install_id}/log")
def action_log(
    install_id: int, limit: int = Query(50, ge=1, le=200), db: Session = Depends(get_db)
):
    if db.get(IntegrationInstall, install_id) is None:
        raise HTTPException(404, "That integration isn't connected.")
    kid = aliased(User)
    rows = (
        db.query(IntegrationAction, kid, Chore.title)
        .outerjoin(kid, kid.id == IntegrationAction.kid_id)
        .outerjoin(Chore, Chore.id == IntegrationAction.chore_id)
        .filter(IntegrationAction.install_id == install_id)
        .order_by(IntegrationAction.created_at.desc(), IntegrationAction.id.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "kind": a.kind,
            "result": a.result,
            "reason": a.reason,
            "kid_name": first_name(k) if k else None,
            "chore_title": title,
            "created_at": utc_z(a.created_at),
        }
        for a, k, title in rows
    ]
