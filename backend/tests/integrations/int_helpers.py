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
