"""Shared integration test fixtures data: a fixed signing key and a valid manifest."""

import base64
import json

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

TEST_KEY = Ed25519PrivateKey.from_private_bytes(
    bytes.fromhex("017de45fe8207b25416f5923c4cf8870e76c477473410d067a728cd2fc20e0e0")
)

DEMO = {
    "id": "demo",
    "name": "Demo",
    "developer": "Demo Dev",
    "description": "A demo integration.",
    "icon": "extension",
    "version": "1.0.0",
    "protocol": "v1",
    "base_url": "https://svc.example",
    "settings": [],
    "permissions": ["chores.complete"],
    "widgets": [],
}


def sign_env(obj, key=TEST_KEY) -> dict:
    """Sign obj as a registry envelope: base64 JSON payload plus base64 Ed25519 signature."""
    raw = json.dumps(obj).encode()
    return {
        "payload": base64.b64encode(raw).decode(),
        "sig": base64.b64encode(key.sign(raw)).decode(),
    }


def cc(key, kid_id, chore_id) -> dict:
    return {
        "type": "chore.complete",
        "idempotency_key": key,
        "kid_id": kid_id,
        "chore_id": chore_id,
    }


def ru(key, ref="r", name="Reward", price=10, icon=None) -> dict:
    return {
        "type": "reward.upsert",
        "idempotency_key": key,
        "ref": ref,
        "name": name,
        "price": price,
        "icon": icon,
    }


def msg(key, title="hi", body=None) -> dict:
    return {"type": "message.parents", "idempotency_key": key, "title": title, "body": body}


def rd(key, target, id_, approve, note=None) -> dict:
    return {
        "type": "request.decide",
        "idempotency_key": key,
        "target": target,
        "id": id_,
        "approve": approve,
        "note": note,
    }


def text(t, tone="normal", link=None) -> dict:
    return {"type": "text", "text": t, "tone": tone, "link": link}


def image(url, alt="") -> dict:
    return {"type": "image", "url": url, "alt": alt}


def button(id, action, label=None) -> dict:
    return {"type": "button", "id": id, "label": label or id, "action": action}


def card(*children, title=None) -> dict:
    return {"type": "card", "title": title, "children": list(children)}


def W(id, root) -> dict:
    return {"id": id, "root": root}


class Signer:
    def __init__(self, key):
        self.key = key

    def sign(self, obj) -> dict:
        return sign_env(obj, self.key)

    def catalog(self, manifests, revoked=(), issued_at=None) -> dict:
        """Outer catalog envelope as the registry Worker builds it (registry/src/index.ts)."""
        from datetime import UTC, datetime

        at = issued_at or datetime.now(UTC).replace(tzinfo=None)
        body = {
            "v": 1,
            "issued_at": at.isoformat(timespec="milliseconds") + "Z",
            "integrations": [self.sign(m) for m in manifests],
            "revoked": list(revoked),
        }
        return self.sign(body)


def other_signer() -> Signer:
    return Signer(Ed25519PrivateKey.from_private_bytes(bytes(range(32))))


def streamed(content: bytes):
    """A wire-like body stream (httpx pre-reads content=, which a real transport never does)."""
    import httpx

    class _Body(httpx.SyncByteStream):
        def __iter__(self):
            yield content

    return _Body()


def reply(status, headers=None, content=b""):
    """A MockTransport that answers every request with the given status, headers and body."""
    import httpx

    return httpx.MockTransport(
        lambda req: httpx.Response(status, headers=headers, stream=streamed(content))
    )


def bell_item(client, headers, kind) -> dict:
    """The newest bell row of this kind."""
    items = client.get("/api/v1/notifications", headers=headers).json()["items"]
    return max((i for i in items if i["kind"] == kind), key=lambda i: i["id"])


DEMO_SETTINGS = [
    {"key": "username", "label": "Username", "type": "username"},
    {"key": "api_key", "label": "API key", "type": "text", "secret": True},
    {"key": "level", "label": "Level", "type": "number", "required": False},
    {"key": "mode", "label": "Mode", "type": "select", "options": ["easy", "hard"]},
]
DEMO_FULL = {**DEMO, "settings": DEMO_SETTINGS}  # DEMO as the synced catalog lists it
KIDCARDS = {
    **DEMO,
    "id": "kidcards",
    "name": "Kid cards",
    "permissions": ["chores.complete", "widgets.kid"],
    "widgets": [{"id": "k", "surface": "kid", "title": "Cards"}],
    "poll_seconds": 300,
}
GONE = {**DEMO, "id": "gone", "name": "Gone"}  # listed, but also revoked


def install_body(kid, **over) -> dict:
    """A valid POST /api/v1/integrations body for DEMO_FULL, linked to `kid`."""
    return {
        "integration_id": "demo",
        "settings": {"username": "sam", "api_key": "k-123", "mode": "easy"},
        "kid_ids": [kid.id],
        "chore_ids": [],
        "kid_widget_ids": [],
        "accepted_permissions": ["chores.complete"],
        **over,
    }


def db_install(id):
    """The install row, read through the test session the API client uses."""
    from app.api.deps import get_db
    from app.main import fastapi_app
    from app.models.integration import IntegrationInstall

    db = next(fastapi_app.dependency_overrides[get_db]())
    db.expire_all()
    return db.get(IntegrationInstall, id)
