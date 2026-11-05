"""iPhone hand-off code: a typed code moves the sign-in from Safari into the home-screen app."""

import re

import pytest
from app.api.kid_enroll import HANDOFF_GONE
from app.core.config import settings
from app.models.kid_device import KidDevice
from app.services import kid_enroll, kid_handoff
from app.services.kid_enroll import hash_token

KID = "/api/v1/kid"
SHAPE = re.compile(r"^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$")


@pytest.fixture(autouse=True)
def upstream(monkeypatch):
    monkeypatch.setattr(settings, "NTFY_UPSTREAM_URL", "https://ntfy.sh")


def _enroll(client, db, kid):
    raw = kid_enroll.issue(db, kid, kid)[0]
    return client.post(f"{KID}/enroll", json={"token": raw}).json()


def _hand(client, code):
    return client.post(f"{KID}/handoff", json={"code": code})


def _session(client, tok):
    return client.post(f"{KID}/session", json={"device_token": tok})


def test_enroll_returns_handoff_not_session(client, kid, db):
    body = _enroll(client, db, kid)
    assert SHAPE.match(body["handoff"])
    assert "handoff" not in _session(client, body["device_token"]).json()


def test_redeem_rotates_secret(client, kid, db):
    body = _enroll(client, db, kid)
    r = _hand(client, body["handoff"].lower().replace("-", ""))
    assert r.status_code == 200
    new = r.json()
    assert set(new) == {"access_token", "device_token", "kid", "alert"}
    assert new["device_token"] != body["device_token"]
    assert _session(client, body["device_token"]).status_code == 401
    assert _session(client, new["device_token"]).status_code == 200
    assert db.query(KidDevice).one().secret_hash == hash_token(new["device_token"])
    ok = client.get(f"{KID}/today", headers={"Authorization": f"Bearer {new['access_token']}"})
    assert ok.status_code == 200


def test_lookalikes_and_spaces(client, kid, db):
    code = _enroll(client, db, kid)["handoff"]
    typed = " " + code.replace("0", "o").replace("1", "l") + " "
    assert _hand(client, typed).status_code == 200


def test_second_use_410(client, kid, db):
    code = _enroll(client, db, kid)["handoff"]
    assert _hand(client, code).status_code == 200
    r = _hand(client, code)
    assert r.status_code == 410 and r.json()["detail"] == HANDOFF_GONE


def test_expired_410(client, kid, db, monkeypatch):
    code = _enroll(client, db, kid)["handoff"]
    t = kid_handoff._now()
    monkeypatch.setattr(kid_handoff, "_now", lambda: t + 15 * 60 + 1)
    assert _hand(client, code).status_code == 410


def test_removed_phone_410(client, kid, db):
    code = _enroll(client, db, kid)["handoff"]
    db.delete(db.query(KidDevice).one())
    db.commit()
    r = _hand(client, code)
    assert r.status_code == 410 and r.json()["detail"] == HANDOFF_GONE


def test_inactive_kid_410(client, kid, db):
    body = _enroll(client, db, kid)
    kid.is_active = False
    db.commit()
    assert _hand(client, body["handoff"]).status_code == 410
    assert db.query(KidDevice).one().secret_hash == hash_token(body["device_token"])


def test_new_handoff_replaces_old(client, kid, db):
    first = _enroll(client, db, kid)["handoff"]
    dev = db.query(KidDevice).one()
    second = kid_handoff.issue(dev)
    assert _hand(client, first).status_code == 410
    assert _hand(client, second).status_code == 200


def test_store_capped():
    for i in range(kid_handoff.MAX + 5):
        kid_handoff.issue(KidDevice(id=i, secret_hash=str(i)))
    assert len(kid_handoff._store) == kid_handoff.MAX


def test_reused_device_id_410(client, kid, db):
    old = _enroll(client, db, kid)["handoff"]
    first = db.query(KidDevice).one()
    first_id, now = first.id, first.created_at
    db.delete(first)
    db.commit()
    db.add(
        KidDevice(
            id=first_id, kid_id=kid.id, secret_hash="x", label="n", created_at=now, last_seen_at=now
        )
    )
    db.commit()  # a newer phone got the same id and has no code of its own
    r = _hand(client, old)
    assert r.status_code == 410 and r.json()["detail"] == HANDOFF_GONE
    assert db.query(KidDevice).one().secret_hash == "x"


def test_wrong_codes_lock_out(client, kid, db):
    code = _enroll(client, db, kid)["handoff"]
    for _ in range(5):
        assert _hand(client, "AAAA-AAAA").status_code == 410
    r = _hand(client, code)
    assert r.status_code == 429 and "Too many tries" in r.json()["detail"]
