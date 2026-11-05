"""Integration wire protocol: closed action vocabulary, v1 wire models and HMAC signing."""

import hmac
from hashlib import sha256
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

_Key = Annotated[str, Field(pattern=r"^[A-Za-z0-9._:-]{1,80}$")]


class _Base(BaseModel):
    model_config = ConfigDict(extra="forbid")
    idempotency_key: _Key


class ChoreComplete(_Base):
    type: Literal["chore.complete"] = "chore.complete"
    kid_id: int
    chore_id: int


class RewardUpsert(_Base):
    type: Literal["reward.upsert"] = "reward.upsert"
    ref: str = Field(max_length=64)
    name: str = Field(max_length=100)
    price: int = Field(ge=1, le=100000)
    icon: str | None = Field(default=None, max_length=40)


class RewardRemove(_Base):
    type: Literal["reward.remove"] = "reward.remove"
    ref: str = Field(max_length=64)


class MessageParents(_Base):
    type: Literal["message.parents"] = "message.parents"
    title: str = Field(max_length=100)
    body: str | None = Field(default=None, max_length=300)


class RequestDecide(_Base):
    type: Literal["request.decide"] = "request.decide"
    target: Literal["reward", "chore"]
    id: int
    approve: bool
    note: str | None = Field(default=None, max_length=200)


ACTION_MODELS = (ChoreComplete, RewardUpsert, RewardRemove, MessageParents, RequestDecide)
Action = Annotated[
    ChoreComplete | RewardUpsert | RewardRemove | MessageParents | RequestDecide,
    Field(discriminator="type"),
]
_BY_TYPE = {m.model_fields["type"].default: m for m in ACTION_MODELS}


def parse_action(raw: dict) -> Action:
    t = raw.get("type") if isinstance(raw, dict) else None
    model = _BY_TYPE.get(t) if isinstance(t, str) else None
    if model is None:
        raise ValueError("unknown action")
    try:
        return model.model_validate(raw)
    except ValidationError as e:
        raise ValueError("bad action") from e


PROTOCOL_VERSION = "v1"
_SIG_PREFIX = PROTOCOL_VERSION + "="


def _mac(secret: str, prefix: str, body: bytes) -> str:
    mac = hmac.new(secret.encode(), prefix.encode() + body, sha256).hexdigest()
    return _SIG_PREFIX + mac


def sign_request(secret: str, ts: int, request_id: str, body: bytes) -> str:
    return _mac(secret, f"{ts}.{request_id}.", body)


def sign_reply(secret: str, request_id: str, body: bytes) -> str:
    return _mac(secret, f"{request_id}.", body)


def verify(sig_header: str, expected: str) -> bool:
    return hmac.compare_digest(str(sig_header).encode(), expected.encode())


def grant_out(
    permissions: list[str], kids: list[tuple[int, str]], chores: list[tuple[int, str]]
) -> dict:
    """What the box tells the service about a grant. Names only with their permission."""
    names = "kid.name" in permissions
    return {
        "permissions": list(permissions),
        "kids": [{"id": i, **({"first_name": n} if names else {})} for i, n in kids],
        "chores": (
            [{"id": i, "title": t} for i, t in chores] if "chores.complete" in permissions else []
        ),
    }


class Reply(BaseModel):
    model_config = ConfigDict(extra="ignore")
    request_id: str
    actions: list[dict] = Field(default=[], max_length=20)


class WidgetsReply(BaseModel):
    model_config = ConfigDict(extra="ignore")
    request_id: str
    widgets: list[dict]
