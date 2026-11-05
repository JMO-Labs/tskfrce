"""Box-side client for the v1 integration protocol. No routes, no DB: reusable by the simulator."""

import json
import time
import uuid
from dataclasses import dataclass, field

from pydantic import BaseModel, ValidationError

from app.integrations import net
from app.integrations.net import STRICT, OutboundPolicy
from app.integrations.protocol import (
    PROTOCOL_VERSION,
    Reply,
    WidgetsReply,
    sign_reply,
    sign_request,
    verify,
)

MAX_REPLY = 262_144
TIMEOUT = 5.0


class ProtocolError(Exception):
    """Any failure talking to a service: blocked, transport, status, signature, shape.

    Callers catch only this."""


@dataclass
class InstallCtx:
    public_id: str
    base_url: str
    secret: str = field(repr=False)
    grant_out: dict


class BoxClient:
    def __init__(
        self, ctx: InstallCtx, policy: OutboundPolicy = STRICT, transport=None, now=time.time
    ):
        self.ctx, self.policy, self.transport, self.now = ctx, policy, transport, now
        self.last_request: tuple[str, bytes, dict] | None = None  # (name, body, headers)

    def raw_post(self, path: str, body: bytes, headers: dict) -> net.GuardedResponse:
        """POST body to {base_url}/v1/{path} as given, unchecked (the simulator's replay)."""
        url = f"{self.ctx.base_url.rstrip('/')}/{PROTOCOL_VERSION}/{path}"
        try:
            return net.fetch(
                "POST",
                url,
                body=body,
                headers=headers,
                policy=self.policy,
                max_bytes=MAX_REPLY,
                timeout=TIMEOUT,
                transport=self.transport,
            )
        except net.BlockedError as e:
            raise ProtocolError("blocked") from e
        except net.FetchError as e:
            raise ProtocolError(str(e)) from e

    def _call(self, name: str, extra: dict, grant: dict | None = None) -> dict:
        rid = uuid.uuid4().hex
        body = json.dumps(
            {
                "protocol": PROTOCOL_VERSION,
                "install_id": self.ctx.public_id,
                "request_id": rid,
                "grant": grant or self.ctx.grant_out,
                **extra,
            },
            separators=(",", ":"),
        ).encode()
        ts = int(self.now())
        headers = {
            "Content-Type": "application/json",
            "X-Tsk-Install": self.ctx.public_id,
            "X-Tsk-Timestamp": str(ts),
            "X-Tsk-Request-Id": rid,
            "X-Tsk-Signature": sign_request(self.ctx.secret, ts, rid, body),
        }
        self.last_request = (name, body, headers)
        resp = self.raw_post(name, body, headers)
        got = {k.lower(): v for k, v in (resp.headers or {}).items()}.get("x-tsk-signature", "")
        if not verify(got, sign_reply(self.ctx.secret, rid, resp.body)):
            raise ProtocolError("bad signature")
        try:
            data = json.loads(resp.body)
        except (ValueError, RecursionError) as e:
            raise ProtocolError("not json") from e
        if not isinstance(data, dict):
            raise ProtocolError("schema")
        if data.get("request_id") != rid:
            raise ProtocolError("request_id mismatch")
        return data

    def _parse(self, model: type[BaseModel], data: dict):
        try:
            return model.model_validate(data)
        except ValidationError as e:
            raise ProtocolError("schema") from e

    def install(self, settings: dict) -> Reply:
        """The only call that carries the box-generated secret, so the service can verify."""
        extra = {"settings": settings, "secret": self.ctx.secret}
        return self._parse(Reply, self._call("install", extra))

    def events(self, events: list[dict]) -> Reply:
        return self._parse(Reply, self._call("events", {"events": events}))

    def poll(self) -> Reply:
        return self._parse(Reply, self._call("poll", {}))

    def widgets(
        self, surface: str, kid_id: int | None, grant_out: dict | None = None
    ) -> WidgetsReply:
        """grant_out overrides the stored grant the service sees (kid cards show one kid)."""
        extra = {"surface": surface, **({"kid_id": kid_id} if kid_id is not None else {})}
        call = (
            self._call("widgets", extra, grant_out) if grant_out else self._call("widgets", extra)
        )
        return self._parse(WidgetsReply, call)

    def uninstall(self) -> None:
        self._call("uninstall", {})
