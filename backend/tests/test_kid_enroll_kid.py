"""Kid side of phone enrollment: redeem a one-time code, refresh, instant revocation."""

from datetime import datetime, timedelta

import pytest
from app.api.kid_enroll import ENROLL_GONE, PHONE_REMOVED
from app.core.auth import AuthService
from app.core.config import settings
from app.core.database import Base, _import_all_models
from app.main import fastapi_app
from app.models.kid_device import KidDevice, KidEnrollToken
from app.models.user import User, UserRole
from app.services import kid_enroll
from app.services.kid_enroll import hash_token
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

KID = "/api/v1/kid"
IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148"


@pytest.fixture(autouse=True)
def upstream(monkeypatch):
    monkeypatch.setattr(settings, "NTFY_UPSTREAM_URL", "https://ntfy.sh")


def _code(db, kid, parent=None):
    return kid_enroll.issue(db, kid, parent or kid)[0]


def _enroll(client, raw, ua=IPHONE):
    return client.post(f"{KID}/enroll", json={"token": raw}, headers={"User-Agent": ua})


def _bearer(tok):
    return {"Authorization": f"Bearer {tok}"}


def test_redeem_signs_kid_in(client, kid, db):
    r = _enroll(client, _code(db, kid))
    assert r.status_code == 200
    body = r.json()
    assert body["kid"] == {"id": kid.id, "full_name": kid.full_name, "avatar": kid.avatar}
    assert len(body["device_token"]) >= 43  # token_urlsafe(32)
    dev = db.query(KidDevice).one()
    assert dev.kid_id == kid.id and dev.label == "iPhone"
    assert dev.secret_hash == hash_token(body["device_token"])
    assert body["device_token"] not in dev.secret_hash
    assert client.get(f"{KID}/today", headers=_bearer(body["access_token"])).status_code == 200


def test_redeem_returns_alert_topic(client, kid, db):
    a = _enroll(client, _code(db, kid)).json()["alert"]
    assert a["server"] == "https://ntfy.sh" and len(a["topic"]) >= 32
    b = _enroll(client, _code(db, kid)).json()["alert"]
    assert b == a
    db.refresh(kid)
    assert kid.alert_topic == a["topic"]


def test_alert_none_when_upstream_off(client, kid, db, monkeypatch):
    monkeypatch.setattr(settings, "NTFY_UPSTREAM_URL", "")
    body = _enroll(client, _code(db, kid)).json()
    assert body["alert"] is None
    r = client.post(f"{KID}/session", json={"device_token": body["device_token"]})
    assert r.json()["alert"] is None


def test_alert_server_slash_stripped(client, kid, db, monkeypatch):
    monkeypatch.setattr(settings, "NTFY_UPSTREAM_URL", "https://ntfy.example.net/")
    body = _enroll(client, _code(db, kid)).json()
    assert body["alert"]["server"] == "https://ntfy.example.net"
    r = client.post(f"{KID}/session", json={"device_token": body["device_token"]})
    assert r.json()["alert"] == body["alert"]


def test_alert_topic_not_in_parent_api(client, kid, db, parent_headers):
    _enroll(client, _code(db, kid))
    db.refresh(kid)
    topic = kid.alert_topic
    assert topic
    for path in ("/api/v1/kids", f"/api/v1/kids/{kid.id}/phones", f"/api/v1/kids/{kid.id}/points"):
        r = client.get(path, headers=parent_headers)
        assert r.status_code == 200, path
        assert topic not in r.text and "alert_topic" not in r.text, path
    r = client.patch(f"/api/v1/kids/{kid.id}", json={"full_name": "Tim"}, headers=parent_headers)
    assert r.status_code == 200 and topic not in r.text


def test_redeem_twice_second_gets_410(client, kid, db):
    raw = _code(db, kid)
    assert _enroll(client, raw).status_code == 200
    r = _enroll(client, raw)
    assert r.status_code == 410 and r.json()["detail"] == ENROLL_GONE
    assert db.query(KidDevice).count() == 1


def test_redeem_race_one_winner(tmp_path):
    """Two sessions interleave: A reads the token first, B redeems; A must lose."""
    _import_all_models()
    engine = create_engine(f"sqlite:///{tmp_path / 'race.db'}")
    Base.metadata.create_all(engine)
    make = sessionmaker(bind=engine, autoflush=False)
    setup = make()
    kid = User(username="k", email="k@family.local", hashed_password="x", role=UserRole.KID)
    setup.add(kid)
    setup.commit()
    raw = kid_enroll.issue(setup, kid, kid)[0]
    kid_id = kid.id
    setup.close()
    a, b = make(), make()
    try:
        row = a.query(KidEnrollToken).filter_by(token_hash=hash_token(raw)).one()
        assert row.used_at is None  # A holds a stale, still-open view
        won_b = kid_enroll.redeem(b, raw, IPHONE)
        won_a = kid_enroll.redeem(a, raw, IPHONE)
        results = [won_a, won_b]
        assert sum(x is not None for x in results) == 1
        assert won_b is not None and won_a is None
        assert b.query(KidDevice).filter_by(kid_id=kid_id).count() == 1
    finally:
        a.close()
        b.close()
        engine.dispose()


def test_expired_token_410(client, kid, db):
    raw = _code(db, kid)
    row = db.query(KidEnrollToken).one()
    row.expires_at = datetime.utcnow() - timedelta(seconds=1)
    db.commit()
    r = _enroll(client, raw)
    assert r.status_code == 410 and r.json()["detail"] == ENROLL_GONE


def test_voided_token_410(client, kid, db):
    first = _code(db, kid)
    second = _code(db, kid)
    assert _enroll(client, first).status_code == 410
    assert _enroll(client, second).status_code == 200


def test_inactive_kid_410(client, kid, db):
    raw = _code(db, kid)
    kid.is_active = False
    db.commit()
    assert _enroll(client, raw).status_code == 410
    assert db.query(KidDevice).count() == 0


def test_unknown_token_410(client, kid):
    assert _enroll(client, "nope").status_code == 410


def test_label_from_user_agent():
    lab = kid_enroll.device_label
    assert lab(IPHONE) == "iPhone"
    assert lab("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)") == "iPad"
    assert lab("Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari/537.36") == "Android phone"
    assert lab("Mozilla/5.0 (Linux; Android 13; SM-X200) Safari/537.36") == "Android tablet"
    assert lab("Mozilla/5.0 (Windows NT 10.0; Win64; x64)") == "Phone or computer"
    assert lab("") == "Phone or computer"


def test_session_refresh_returns_new_access(client, kid, db):
    dev_tok = _enroll(client, _code(db, kid)).json()["device_token"]
    r = client.post(f"{KID}/session", json={"device_token": dev_tok})
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"access_token", "kid", "alert"}
    assert body["kid"] == {"id": kid.id, "full_name": kid.full_name, "avatar": kid.avatar}
    assert body["alert"]["topic"] and body["alert"]["server"] == "https://ntfy.sh"
    assert client.get(f"{KID}/today", headers=_bearer(body["access_token"])).status_code == 200


def test_session_stamps_last_seen_at_most_every_5_min(client, kid, db):
    dev_tok = _enroll(client, _code(db, kid)).json()["device_token"]
    dev = db.query(KidDevice).one()
    recent = datetime.utcnow() - timedelta(minutes=2)
    dev.last_seen_at = recent
    db.commit()
    client.post(f"{KID}/session", json={"device_token": dev_tok})
    db.refresh(dev)
    assert dev.last_seen_at == recent
    dev.last_seen_at = datetime.utcnow() - timedelta(days=30)
    db.commit()
    client.post(f"{KID}/session", json={"device_token": dev_tok})
    db.refresh(dev)
    assert datetime.utcnow() - dev.last_seen_at < timedelta(minutes=1)


def test_removed_phone_access_token_401(client, kid, db, parent_headers):
    body = _enroll(client, _code(db, kid)).json()
    pid = db.query(KidDevice).one().id
    r = client.delete(f"/api/v1/kids/{kid.id}/phones/{pid}", headers=parent_headers)
    assert r.status_code == 204
    assert client.get(f"{KID}/today", headers=_bearer(body["access_token"])).status_code == 401
    r = client.post(f"{KID}/session", json={"device_token": body["device_token"]})
    assert r.status_code == 401 and r.json()["detail"] == PHONE_REMOVED


def test_sid_of_other_kid_401(client, kid, db):
    _enroll(client, _code(db, kid))
    dev = db.query(KidDevice).one()
    sis = User(username="sis", email="s@family.local", hashed_password="x", role=UserRole.KID)
    db.add(sis)
    db.commit()
    tok = AuthService(db).create_access_token(data={"sub": str(sis.id), "sid": dev.id})
    assert client.get(f"{KID}/today", headers=_bearer(tok)).status_code == 401


def test_idle_180_days_401_and_row_deleted(client, kid, db):
    dev_tok = _enroll(client, _code(db, kid)).json()["device_token"]
    dev = db.query(KidDevice).one()
    dev.last_seen_at = datetime.utcnow() - kid_enroll.SESSION_IDLE - timedelta(minutes=1)
    db.commit()
    r = client.post(f"{KID}/session", json={"device_token": dev_tok})
    assert r.status_code == 401 and r.json()["detail"] == PHONE_REMOVED
    assert db.query(KidDevice).count() == 0


def test_session_inactive_kid_401(client, kid, db):
    dev_tok = _enroll(client, _code(db, kid)).json()["device_token"]
    kid.is_active = False
    db.commit()
    assert client.post(f"{KID}/session", json={"device_token": dev_tok}).status_code == 401


def test_parent_token_unaffected(client, parent_headers):
    assert client.get("/api/v1/auth/me", headers=parent_headers).status_code == 200


def test_ip_kid_login_token_unaffected(client, kid_headers):
    assert client.get(f"{KID}/today", headers=kid_headers).status_code == 200


def test_enrolled_kid_token_cannot_issue_403(client, kid, db, monkeypatch):
    monkeypatch.setattr(settings, "BOX_URL", "https://abc123.taskfrce.jmolabs.dev")
    tok = _enroll(client, _code(db, kid)).json()["access_token"]
    r = client.post(f"/api/v1/kids/{kid.id}/enroll", headers=_bearer(tok))
    assert r.status_code == 403
    assert client.get(f"/api/v1/kids/{kid.id}/phones", headers=_bearer(tok)).status_code == 403


def test_enroll_failures_rate_limited(client):
    for _ in range(10):
        assert _enroll(client, "bad").status_code == 410
    assert _enroll(client, "bad").status_code == 429


def test_session_failures_rate_limited(client):
    for _ in range(10):
        r = client.post(f"{KID}/session", json={"device_token": "bad"})
        assert r.status_code == 401
    assert client.post(f"{KID}/session", json={"device_token": "bad"}).status_code == 429


def test_long_token_rejected_422(client):
    assert _enroll(client, "x" * 65).status_code == 422
    assert client.post(f"{KID}/session", json={"device_token": "x" * 65}).status_code == 422


def test_token_never_in_url_routes():
    paths = list(fastapi_app.openapi()["paths"])
    assert f"{KID}/enroll" in paths and f"{KID}/session" in paths
    assert not [p for p in paths if p.startswith(KID) and "{token}" in p]
