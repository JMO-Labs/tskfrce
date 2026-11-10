"""Envelope signed by the registry Worker (registry/src/sign.ts) verifies with trust.py."""

import json
from pathlib import Path

import pytest
from app.integrations import trust

FIX = Path(__file__).resolve().parents[3] / "registry/test/fixtures/envelope.json"


def test_worker_envelope_verifies(monkeypatch):
    fx = json.loads(FIX.read_text())
    monkeypatch.setattr(trust, "REGISTRY_PUBKEY", fx["pubkey"])
    assert trust.verify_envelope(fx["envelope"]) == {"v": 1, "name": "café ✓", "n": [1, 2]}


def test_worker_envelope_tamper_rejected(monkeypatch):
    fx = json.loads(FIX.read_text())
    monkeypatch.setattr(trust, "REGISTRY_PUBKEY", fx["pubkey"])
    env = {**fx["envelope"], "payload": fx["envelope"]["payload"][:-4] + "AAAA"}
    with pytest.raises(trust.UntrustedError):
        trust.verify_envelope(env)
