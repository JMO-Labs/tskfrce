"""Install persistence: the grant stored on the box, the sealed secret and a client for it."""

import json
import secrets

import httpx
from sqlalchemy.orm import Session

from app.core.crypto import seal, unseal
from app.integrations.client import BoxClient, InstallCtx
from app.integrations.manifest import load_manifest
from app.integrations.net import STRICT
from app.integrations.permissions import Grant
from app.integrations.protocol import grant_out
from app.models.chores import Chore
from app.models.integration import IntegrationChore, IntegrationInstall, IntegrationKid
from app.models.user import User
from app.services.chat_extras import first_name

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
