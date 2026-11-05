"""Install persistence: the grant stored on the box, the sealed secret and a client for it."""

import json
import logging
import secrets
from datetime import datetime

import httpx
from sqlalchemy.orm import Session

from app.core.crypto import seal, unseal
from app.integrations.client import BoxClient, InstallCtx
from app.integrations.manifest import load_manifest
from app.integrations.net import STRICT
from app.integrations.permissions import Grant
from app.integrations.protocol import grant_out
from app.models.chores import Chore, ChoreRun
from app.models.integration import (
    IntegrationAction,
    IntegrationChore,
    IntegrationEvent,
    IntegrationInstall,
    IntegrationKid,
)
from app.models.reward import Reward
from app.models.user import User
from app.services import economy
from app.services.chat_extras import first_name

log = logging.getLogger(__name__)
PURPOSE = "integrations"
_transport: httpx.BaseTransport | None = None  # the single test seam for every BoxClient


def new_secret() -> str:
    return secrets.token_urlsafe(32)


def seal_secret(s: str) -> str:
    return seal(s, purpose=PURPOSE)


def secret_of(install: IntegrationInstall) -> str:
    return unseal(install.secret, purpose=PURPOSE)


def _kids(db: Session, install_id: int) -> list[IntegrationKid]:
    return db.query(IntegrationKid).filter_by(install_id=install_id).all()


def _chore_ids(db: Session, install_id: int) -> frozenset[int]:
    rows = db.query(IntegrationChore.chore_id).filter_by(install_id=install_id)
    return frozenset(c for (c,) in rows)


def retire(db: Session, install: IntegrationInstall, status: str) -> None:
    """Stop an install for good: drop its secret, rewards and outbox. Audit rows are kept.
    The caller commits."""
    install.status = status
    install.secret = None
    for r in db.query(Reward).filter_by(integration_install_id=install.id, active=True):
        economy.deactivate_reward(r)  # also denies pending requests
    db.query(IntegrationEvent).filter_by(install_id=install.id).delete()


def reward_visible_to(db: Session, reward: Reward, kid_id: int) -> bool:
    """Core rewards are for everyone. An integration's reward needs a live install the kid is
    linked to."""
    if reward.integration_install_id is None:
        return True
    inst = db.get(IntegrationInstall, reward.integration_install_id)
    return (
        inst is not None
        and inst.status in ("active", "paused")
        and db.get(IntegrationKid, (inst.id, kid_id)) is not None
    )


def remove(db: Session, install: IntegrationInstall, now: datetime) -> None:
    """Parent removal: tell the service (best effort, only with a secret), then retire.
    The caller commits."""
    if install.secret is not None:
        try:
            client_for(db, install).uninstall()
        except Exception as e:  # never blocks removal
            log.warning("Uninstall call to %s failed: %s", install.name, type(e).__name__)
    retire(db, install, "removed")
    install.removed_at = now


def load_grant(db: Session, install: IntegrationInstall) -> Grant:
    """The grant as stored on the box. The manifest is never consulted."""
    kids = _kids(db, install.id)
    return Grant(
        install_id=install.id,
        name=install.name,
        permissions=frozenset(json.loads(install.permissions)),
        kid_ids=frozenset(k.kid_id for k in kids),
        chore_ids=_chore_ids(db, install.id),
        kid_widget_ids=frozenset(k.kid_id for k in kids if k.kid_widgets),
        trusted=bool(install.trusted),
        active=install.status == "active",
    )


def client_for(db: Session, install: IntegrationInstall) -> BoxClient:
    kid_ids = [k.kid_id for k in _kids(db, install.id)]
    kids = db.query(User).filter(User.id.in_(kid_ids)).order_by(User.id).all()
    chores = (
        db.query(Chore).filter(Chore.id.in_(_chore_ids(db, install.id))).order_by(Chore.id).all()
    )
    ctx = InstallCtx(
        public_id=install.public_id,
        base_url=load_manifest(json.loads(install.manifest)).base_url,
        secret=secret_of(install),
        grant_out=grant_out(
            json.loads(install.permissions),
            [(k.id, first_name(k)) for k in kids],
            [(c.id, c.title) for c in chores],
        ),
    )
    return BoxClient(ctx, STRICT, transport=_transport)


def pending_by_run(db: Session, runs: list[ChoreRun]) -> dict[int, dict]:
    """run_id -> the install that completed it, for submitted runs still waiting on a parent."""
    sub = {r.id: r for r in runs if r.status == "submitted"}
    if not sub:
        return {}
    rows = (
        db.query(IntegrationAction.run_id, IntegrationAction.created_at, IntegrationInstall)
        .join(IntegrationInstall, IntegrationInstall.id == IntegrationAction.install_id)
        .filter(
            IntegrationAction.run_id.in_(sub),
            IntegrationAction.result == "pending",
            IntegrationAction.kind == "chore.complete",
        )
        .order_by(IntegrationAction.id)
        .all()
    )
    return {
        rid: {"id": i.id, "name": i.name, "icon": i.icon}
        for rid, at, i in rows
        if sub[rid].submitted_at is not None and at >= sub[rid].submitted_at
    }
