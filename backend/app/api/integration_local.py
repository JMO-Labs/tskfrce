"""Local push keys: Home Assistant and scripts on the home network push actions to the box.

Who is the client? `client_ip` trusts X-Real-IP only from TRUSTED_PROXY_IPS (the frontend
proxy's fixed address and loopback); otherwise it is the socket peer. The frontend proxy
404s these routes whenever Caddy or the edge set X-Real-IP / X-Edge-Token, so the X-Real-IP
it sends here is always its own socket peer, never a forwarded one. X-Forwarded-For and
Forwarded are never read. Pushes through the public hostname are therefore refused; LAN
sources use the box's LAN address (http://<box>:3000/api/proxy/integration-local/push).
"""

import hashlib
import hmac
import ipaddress
import json
import secrets
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_parent
from app.api.integrations import _chores, _kids, _perms
from app.core import ratelimit
from app.core.client_ip import client_ip
from app.integrations.apply import apply_actions
from app.integrations.protocol import PushIn
from app.models.integration import IntegrationChore, IntegrationInstall, IntegrationKid
from app.models.user import User

router = APIRouter(prefix="/api/v1/integration-local", tags=["integrations"])

# Events and widgets need an outbound service, so local keys never get them.
LOCAL_PERMS = frozenset(
    {"chores.complete", "rewards.manage", "messages.parents", "requests.decide"}
)
PREFIX = "tsk_local_"
_LAN = [
    ipaddress.ip_network(n) for n in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "fc00::/7")
]


def is_lan(ip: str) -> bool:
    """Loopback, RFC 1918, IPv6 ULA or link-local. Not CGNAT, not public."""
    try:
        a = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return a.is_loopback or a.is_link_local or any(a in n for n in _LAN if n.version == a.version)


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class LocalKeyIn(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    permissions: list[str] = Field(min_length=1)
    kid_ids: list[int] = Field(min_length=1)
    chore_ids: list[int] = []
    trusted: bool = False

    @field_validator("permissions")
    @classmethod
    def _local_only(cls, v: list[str]) -> list[str]:
        if not set(v) <= LOCAL_PERMS:
            raise ValueError("local keys can't have that permission")
        return sorted(set(v))


@router.get("/permissions")
def permissions(_: User = Depends(require_parent)):
    return _perms(sorted(LOCAL_PERMS))


@router.post("/keys", status_code=201)
def create_key(
    body: LocalKeyIn, db: Session = Depends(get_db), user: User = Depends(require_parent)
):
    kids, chores = _kids(db, set(body.kid_ids)), _chores(db, set(body.chore_ids))
    token = PREFIX + secrets.token_urlsafe(32)
    row = IntegrationInstall(
        public_id=uuid.uuid4().hex,
        source="local",
        name=body.name,
        icon="home",
        permissions=json.dumps(body.permissions),
        key_hash=_hash(token),
        key_prefix=token[:14],
        trusted=body.trusted,
        status="active",
        created_at=datetime.now(UTC).replace(tzinfo=None),
        created_by_id=user.id,
    )
    row.kids = [IntegrationKid(kid_id=k.id) for k in kids]
    row.chores = [IntegrationChore(chore_id=c.id) for c in chores]
    db.add(row)
    db.commit()
    return {"id": row.id, "token": token}  # shown once; only the hash is kept


def require_local_key(
    request: Request, authorization: str = Header(""), db: Session = Depends(get_db)
) -> IntegrationInstall:
    if request.headers.get("x-edge-token") is not None or not is_lan(client_ip(request)):
        raise HTTPException(403, "Local keys only work on your home network.")
    scheme, _, token = authorization.partition(" ")
    bad = HTTPException(401, "That key isn't valid.")
    if scheme != "Bearer" or not token.startswith(PREFIX):
        raise bad
    digest = _hash(token)
    install = (
        db.query(IntegrationInstall)
        .filter_by(key_hash=digest, source="local", status="active")
        .first()
    )
    if install is None or not hmac.compare_digest(install.key_hash, digest):
        raise bad
    try:
        ratelimit.limit(f"int-local:{install.id}", 60, 60)
    except HTTPException as e:
        raise HTTPException(429, "Slow down.") from e
    return install


@router.post("/push")
def push(
    body: PushIn,
    install: IntegrationInstall = Depends(require_local_key),
    db: Session = Depends(get_db),
):
    results = apply_actions(db, install, body.actions, origin="local")
    return {"results": [{"key": r.key, "result": r.result, "reason": r.reason} for r in results]}
