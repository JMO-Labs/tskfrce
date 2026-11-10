"""Ed25519 trust root: verify registry-signed envelopes. Fails closed with no pinned key."""

import base64
import binascii
import json

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

# base64 of the raw 32-byte registry public key. Code constant only; empty trusts nothing.
REGISTRY_PUBKEY: str = ""


class UntrustedError(Exception):
    """Envelope is malformed or not signed by the pinned registry key."""


def verify_envelope(env: dict) -> dict:
    """Return the parsed payload if its signature over the exact decoded bytes verifies."""
    if not REGISTRY_PUBKEY:
        raise UntrustedError("no registry key pinned")
    try:
        raw = base64.b64decode(env["payload"], validate=True)
        sig = base64.b64decode(env["sig"], validate=True)
        key = Ed25519PublicKey.from_public_bytes(base64.b64decode(REGISTRY_PUBKEY, validate=True))
        key.verify(sig, raw)
        obj = json.loads(raw)
    except (KeyError, TypeError, ValueError, binascii.Error, InvalidSignature) as e:
        raise UntrustedError("bad envelope") from e
    if not isinstance(obj, dict):
        raise UntrustedError("payload is not an object")
    return obj
