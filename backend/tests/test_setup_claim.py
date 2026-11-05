"""Setup claim gate: one lockout across every route that takes the code."""

import pytest
from app.core.config import settings
from app.models.user import User

from tests.test_setup import BODY

CODE = "K7M2QXA9PB"
URL = "/api/v1/setup"


@pytest.fixture
def cfg(monkeypatch):
    monkeypatch.setattr(settings, "CLAIM_CODE", CODE)


def _wrong(client, n=5):
    for _ in range(n):
        assert client.post(f"{URL}/claim", json={"code": "nope"}).status_code == 403


def test_status_reports_claim(client, cfg):
    assert client.get(URL).json() == {"needed": True, "claim": True}


def test_setup_without_code_403_no_user(client, db, cfg):
    r = client.post(URL, json=BODY)
    assert r.status_code == 403
    assert (
        r.json()["detail"] == "That code doesn't match this box. Check the sticker and try again."
    )
    assert CODE not in r.text
    assert db.query(User).count() == 0


def test_setup_with_code_201(client, cfg):
    assert client.post(URL, json={**BODY, "claim_code": "k7m2q-xa9pb"}).status_code == 201


def test_claim_endpoint_204_and_403(client, cfg):
    assert client.post(f"{URL}/claim", json={"code": "k7m2q-xa9pb"}).status_code == 204
    r = client.post(f"{URL}/claim", json={"code": "wrong"})
    assert r.status_code == 403
    assert CODE not in r.text


def test_code_length_capped(client, cfg):
    assert client.post(f"{URL}/claim", json={"code": "x" * 33}).status_code == 422
    assert client.post(URL, json={**BODY, "claim_code": "x" * 33}).status_code == 422


def test_sixth_wrong_try_429_even_with_right_code(client, cfg):
    _wrong(client)
    r = client.post(f"{URL}/claim", json={"code": CODE})
    assert r.status_code == 429
    assert CODE not in r.text


def test_claim_after_owner_409(client, cfg):
    assert client.post(URL, json={**BODY, "claim_code": CODE}).status_code == 201
    assert client.post(f"{URL}/claim", json={"code": CODE}).status_code == 409


def test_no_claim_code_setting_no_gate(client):
    assert client.get(URL).json() == {"needed": True, "claim": False}
    assert client.post(f"{URL}/claim", json={"code": "anything"}).status_code == 204
    assert client.post(URL, json=BODY).status_code == 201


def test_step_8_accepted_9_rejected(client, parent_headers):
    assert client.put(f"{URL}/step", json={"step": 8}, headers=parent_headers).status_code == 200
    assert client.put(f"{URL}/step", json={"step": 9}, headers=parent_headers).status_code == 422


def test_claim_lockout_shared_with_setup(client, cfg):
    _wrong(client)
    assert client.post(URL, json={**BODY, "claim_code": CODE}).status_code == 429


def test_setup_wrong_codes_lock_claim_route(client, db, cfg):
    for _ in range(5):
        assert client.post(URL, json={**BODY, "claim_code": "bad"}).status_code in (403, 429)
    assert client.post(f"{URL}/claim", json={"code": CODE}).status_code == 429
    assert db.query(User).count() == 0
