"""Local push keys: Home Assistant and scripts on the home network push actions to the box.

Fail closed. Our frontend proxy sends only X-Real-IP (its own socket peer) and 404s these
routes whenever any forwarding header arrives on the wire. Here a push is refused (403) if
any forwarding header other than X-Real-IP is present, or X-Real-IP comes from a peer that
isn't the frontend container (TRUSTED_PROXY_IPS minus loopback) or isn't a single valid IP. A tunnel or reverse proxy on the LAN or Docker
network therefore can't make outside traffic look local. The client IP must then fall in
LOCAL_PUSH_CIDRS and outside LOCAL_PUSH_EXCLUDE_CIDRS (loopback, link-local, Docker bridges).
LAN sources use the box's LAN address (http://<box>:3000/api/proxy/integration-local/push).
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
from app.core.client_ip import client_ip, from_frontend, norm_ip
from app.core.config import settings
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
# Any of these means a proxy or tunnel relayed the request. X-Real-IP is checked apart:
# our own frontend sets it.
RELAY_HEADERS = (
    "x-forwarded-for",
    "forwarded",
    "x-forwarded-host",
    "x-forwarded-proto",
    "x-edge-token",
    "cf-connecting-ip",
    "true-client-ip",
    "x-client-ip",
    "cf-ray",
)


def _in(a: ipaddress.IPv4Address | ipaddress.IPv6Address, cidrs: str) -> bool:
    nets = (ipaddress.ip_network(n.strip(), strict=False) for n in cidrs.split(",") if n.strip())
    return any(a in n for n in nets if n.version == a.version)


def is_lan(ip: str) -> bool:
    """In LOCAL_PUSH_CIDRS and not in LOCAL_PUSH_EXCLUDE_CIDRS."""
    try:
        a = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return _in(a, settings.LOCAL_PUSH_CIDRS) and not _in(a, settings.LOCAL_PUSH_EXCLUDE_CIDRS)


def relayed(request: Request) -> bool:
    """True if anything but our own frontend proxy forwarded this request."""
    if any(h in request.headers for h in RELAY_HEADERS):
        return True
    real = request.headers.get("x-real-ip")
    return real is not None and (not from_frontend(request) or norm_ip(real) is None)


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
    if relayed(request) or not is_lan(client_ip(request)):
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
