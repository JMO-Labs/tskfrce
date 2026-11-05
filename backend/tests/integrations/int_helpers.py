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
