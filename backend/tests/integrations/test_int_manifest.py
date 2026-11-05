import base64
import json

import pytest
from app.integrations import trust
from app.integrations.manifest import Manifest, load_manifest
from app.integrations.trust import UntrustedError, verify_envelope
from pydantic import ValidationError
from tests.integrations.int_helpers import DEMO, other_signer


def b64(o):
    return base64.b64encode(json.dumps(o).encode()).decode()


def test_signed_manifest_loads(keypair, install):
    assert load_manifest(keypair.sign(DEMO)).id == "demo"
    assert load_manifest(json.loads(install.manifest)).base_url == DEMO["base_url"]


def test_tampered_payload_rejected(keypair):
    env = keypair.sign(DEMO)
    env["payload"] = b64({**DEMO, "name": "Evil"})
    with pytest.raises(UntrustedError):
        load_manifest(env)


def test_other_key_rejected(keypair):
    with pytest.raises(UntrustedError):
        load_manifest(other_signer().sign(DEMO))


def test_empty_pinned_key_fails_closed(keypair, monkeypatch):
    monkeypatch.setattr(trust, "REGISTRY_PUBKEY", "")
    with pytest.raises(UntrustedError):
        load_manifest(keypair.sign(DEMO))


@pytest.mark.parametrize(
    "env", [{}, {"payload": "x"}, {"payload": "!!", "sig": "!!"}, {"payload": 1, "sig": 2}]
)
def test_malformed_envelope(keypair, env):
    with pytest.raises(UntrustedError):
        verify_envelope(env)


def test_non_object_payload(keypair):
    raw = b"[1]"
    env = {
        "payload": base64.b64encode(raw).decode(),
        "sig": base64.b64encode(keypair.key.sign(raw)).decode(),
    }
    with pytest.raises(UntrustedError):
        verify_envelope(env)


@pytest.mark.parametrize(
    "url",
    [
        "http://x.example",
        "https://x.example:8443",
        "https://10.0.0.5",
        "https://[::1]",
        "https://2130706433",
        "https://127.1",
        "https://0x7f000001",
        "https://u:p@x.example",
        "https://x.example/?q=1",
        "https://x.example/#f",
    ],
)
def test_base_url_rules(url):
    with pytest.raises(ValidationError):
        Manifest.model_validate({**DEMO, "base_url": url})


def test_base_url_443_ok():
    Manifest.model_validate({**DEMO, "base_url": "https://x.example:443/api"})


def test_poll_floor():
    with pytest.raises(ValidationError):
        Manifest.model_validate({**DEMO, "poll_seconds": 59})


def test_kid_widget_needs_permission():
    w = {"id": "w", "surface": "kid", "title": "T"}
    with pytest.raises(ValidationError):
        Manifest.model_validate({**DEMO, "widgets": [w]})
    Manifest.model_validate({**DEMO, "widgets": [w], "permissions": ["widgets.kid"]})


def test_unknown_or_duplicate_permission():
    for p in (["nope"], ["kid.name", "kid.name"]):
        with pytest.raises(ValidationError):
            Manifest.model_validate({**DEMO, "permissions": p})


def test_select_needs_options():
    f = {"key": "k", "label": "L", "type": "select"}
    with pytest.raises(ValidationError):
        Manifest.model_validate({**DEMO, "settings": [f]})
    Manifest.model_validate({**DEMO, "settings": [{**f, "options": ["a"]}]})
