"""Local push keys: LAN only, hashed at rest, scoped, rate limited, revocable."""

import json
from hashlib import sha256

import pytest
from app.api.integration_local import LOCAL_PERMS
from app.integrations.permissions import PERMS
from app.main import app
from app.models.integration import IntegrationAction, IntegrationInstall
from fastapi.testclient import TestClient
from tests.integrations.int_helpers import cc, msg, push

LAN = "192.168.1.50"


@pytest.fixture
def client(frontend_client):
    """Peer is the frontend container's fixed IP, so X-Real-IP is honoured (F27)."""
    return frontend_client


def test_create_key_returns_token_once_and_stores_hash(client, parent_headers, kid, db):
    r = client.post(
        "/api/v1/integration-local/keys",
        headers=parent_headers,
        json={"name": "Home Assistant", "permissions": ["chores.complete"], "kid_ids": [kid.id]},
    )
    assert r.status_code == 201
    tok = r.json()["token"]
    row = db.get(IntegrationInstall, r.json()["id"])
    assert tok.startswith("tsk_local_") and row.key_hash == sha256(tok.encode()).hexdigest()
    assert row.source == "local" and row.secret is None and row.manifest is None
    assert row.key_prefix == tok[:14] and row.icon == "home"
    assert tok not in json.dumps(
        client.get(f"/api/v1/integrations/{row.id}", headers=parent_headers).json()
    )
    assert tok not in json.dumps(client.get("/api/v1/integrations", headers=parent_headers).json())


def test_tokens_are_unique_and_high_entropy(client, parent_headers, kid):
    body = {"name": "x", "permissions": ["chores.complete"], "kid_ids": [kid.id]}
    toks = {
        client.post("/api/v1/integration-local/keys", headers=parent_headers, json=body).json()[
            "token"
        ]
        for _ in range(3)
    }
    assert len(toks) == 3 and all(len(t) >= len("tsk_local_") + 43 for t in toks)


def test_create_key_needs_parent(client, kid_headers, kid):
    body = {"name": "x", "permissions": ["chores.complete"], "kid_ids": [kid.id]}
    assert (
        client.post("/api/v1/integration-local/keys", headers=kid_headers, json=body).status_code
        == 403
    )


def test_push_from_lan_applies(client, local_key, kid, run_today, db):
    r = push(client, local_key.token, [cc("ha1", kid.id, run_today.chore_id)], ip=LAN)
    assert r.json()["results"][0]["result"] == "pending"
    row = db.query(IntegrationAction).filter_by(install_id=local_key.id).one()
    assert (row.idempotency_key, row.result) == ("ha1", "pending")
    again = push(client, local_key.token, [cc("ha1", kid.id, run_today.chore_id)], ip=LAN)
    assert again.json()["results"][0]["result"] == "pending"
    assert db.query(IntegrationAction).filter_by(install_id=local_key.id).count() == 1


@pytest.mark.parametrize("ip", ["203.0.113.9", "100.64.1.2", "2001:db8::1", "8.8.8.8"])
def test_push_from_outside_lan_refused(client, local_key, kid, run_today, ip):
    r = push(client, local_key.token, [cc("x", kid.id, run_today.chore_id)], ip=ip)
    assert r.status_code == 403
    assert r.json()["detail"] == "Local keys only work on your home network."


@pytest.mark.parametrize("ip", ["10.1.2.3", "172.16.0.9", "fd00::5"])
def test_lan_ranges_allowed(client, local_key, ip):
    assert push(client, local_key.token, [], ip=ip).status_code == 200


def test_spoofed_forwarded_for_ignored(client, local_key):
    r = client.post(
        "/api/v1/integration-local/push",
        json={"actions": []},
        headers={
            "Authorization": f"Bearer {local_key.token}",
            "X-Real-IP": "203.0.113.9",
            "X-Forwarded-For": LAN,
            "Forwarded": f"for={LAN}",
        },
    )
    assert r.status_code == 403


def test_untrusted_peer_cannot_claim_lan(local_key):
    outside = TestClient(app, base_url="http://localhost", client=("203.0.113.9", 50000))
    assert push(outside, local_key.token, [], ip=LAN).status_code == 403


def test_edge_token_refused(client, local_key):
    r = client.post(
        "/api/v1/integration-local/push",
        json={"actions": []},
        headers={
            "Authorization": f"Bearer {local_key.token}",
            "X-Real-IP": LAN,
            "X-Edge-Token": "a" * 64,
        },
    )
    assert r.status_code == 403


def test_bad_or_removed_key_401(client, parent_headers, local_key):
    assert push(client, "tsk_local_nope", [], ip=LAN).status_code == 401
    assert push(client, local_key.token[len("tsk_local_") :], [], ip=LAN).status_code == 401
    assert (
        client.delete(f"/api/v1/integrations/{local_key.id}", headers=parent_headers).status_code
        == 204
    )
    r = push(client, local_key.token, [], ip=LAN)
    assert r.status_code == 401 and r.json()["detail"] == "That key isn't valid."


def test_local_key_cannot_unlock(client, local_key):
    r = push(client, local_key.token, [{"type": "device.unlock", "idempotency_key": "u"}], ip=LAN)
    assert r.json()["results"][0]["reason"] == "unknown action"


def test_local_key_limited_to_granted_actions(client, local_key):
    r = push(client, local_key.token, [msg("m1")], ip=LAN)
    assert r.json()["results"][0] == {"key": "m1", "result": "rejected", "reason": "not allowed"}


def test_push_caps_actions_at_20(client, local_key):
    assert (
        push(client, local_key.token, [msg(f"m{i}") for i in range(21)], ip=LAN).status_code == 422
    )


def test_local_permissions_list(client, parent_headers):
    r = client.get("/api/v1/integration-local/permissions", headers=parent_headers).json()
    assert {p["id"] for p in r} == LOCAL_PERMS and all(p["text"] == PERMS[p["id"]].text for p in r)
    assert all(p["high_risk"] == PERMS[p["id"]].high_risk for p in r)


def test_rate_limited_after_60(client, local_key):
    codes = [push(client, local_key.token, [], ip=LAN).status_code for _ in range(61)]
    assert codes[-1] == 429 and codes[0] == 200 and codes[59] == 200


def test_rate_limit_is_per_key(client, parent_headers, kid, local_key):
    for _ in range(60):
        push(client, local_key.token, [], ip=LAN)
    other = client.post(
        "/api/v1/integration-local/keys",
        headers=parent_headers,
        json={"name": "y", "permissions": ["chores.complete"], "kid_ids": [kid.id]},
    ).json()["token"]
    assert push(client, other, [], ip=LAN).status_code == 200
    r = push(client, local_key.token, [], ip=LAN)
    assert r.status_code == 429 and r.json()["detail"] == "Slow down."


@pytest.mark.parametrize(
    "perm", ["widgets.kid", "widgets.parent", "events.chore_completed", "kid.name", "nope"]
)
def test_widget_permissions_not_offered(client, parent_headers, kid, perm):
    assert (
        client.post(
            "/api/v1/integration-local/keys",
            headers=parent_headers,
            json={"name": "x", "permissions": [perm], "kid_ids": [kid.id]},
        ).status_code
        == 422
    )


def test_create_key_checks_kids_and_chores(client, parent_headers, kid, parent):
    base = {"name": "x", "permissions": ["chores.complete"]}

    def post(**b):
        return client.post(
            "/api/v1/integration-local/keys",
            headers=parent_headers,
            json={**base, **b},
        ).status_code

    assert post(kid_ids=[]) == 422
    assert post(kid_ids=[parent.id]) == 422
    assert post(kid_ids=[kid.id], chore_ids=[99999]) == 422
    assert post(kid_ids=[kid.id], permissions=[]) == 422
