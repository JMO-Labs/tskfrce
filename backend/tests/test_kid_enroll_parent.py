import logging
from datetime import datetime, timedelta

import pytest
from app.core.config import settings
from app.models.kid_device import KidDevice, KidEnrollToken
from app.models.user import User, UserRole
from app.services.kid_enroll import hash_token

URL = "/api/v1/kids"
BOX = "https://abc123.taskfrce.jmolabs.dev"


@pytest.fixture
def cfg(monkeypatch):
    monkeypatch.setattr(settings, "BOX_URL", BOX)


def _issue(client, kid, headers):
    return client.post(f"{URL}/{kid.id}/enroll", headers=headers)


def _sis(db):
    u = User(username="sally", email="sally@family.local", hashed_password="x", role=UserRole.KID)
    db.add(u)
    db.commit()
    return u


def _phone(db, kid, label="Pixel", secret="s" * 64, age=0):
    t = datetime.utcnow() - timedelta(minutes=age)
    d = KidDevice(kid_id=kid.id, secret_hash=secret, label=label, created_at=t, last_seen_at=t)
    db.add(d)
    db.commit()
    return d


def test_issue_returns_fragment_url_and_qr(client, kid, parent_headers, db, cfg, caplog):
    caplog.set_level(logging.DEBUG)
    r = _issue(client, kid, parent_headers)
    assert r.status_code == 201
    body = r.json()
    url = body["url"]
    assert url.startswith(f"{BOX}/kid#enroll=")
    assert "?" not in url and body["qr_svg"].startswith("<svg")
    assert body["expires_at"].endswith("Z")
    raw = url.split("#enroll=")[1]
    assert len(raw) == 32  # token_urlsafe(24)
    row = db.query(KidEnrollToken).one()
    assert row.token_hash == hash_token(raw) and raw not in row.token_hash
    assert row.kid_id == kid.id and row.used_at is None
    assert timedelta(hours=23, minutes=59) < row.expires_at - row.created_at <= timedelta(hours=24)
    assert raw not in caplog.text


def test_reissue_voids_previous(client, kid, parent_headers, db, cfg):
    a = _issue(client, kid, parent_headers).json()["url"].split("#enroll=")[1]
    b = _issue(client, kid, parent_headers).json()["url"].split("#enroll=")[1]
    assert a != b
    first = db.query(KidEnrollToken).filter_by(token_hash=hash_token(a)).one()
    second = db.query(KidEnrollToken).filter_by(token_hash=hash_token(b)).one()
    assert first.used_at is not None and second.used_at is None


def test_reissue_leaves_other_kids_tokens(client, kid, parent_headers, db, cfg):
    sis = _sis(db)
    _issue(client, sis, parent_headers)
    _issue(client, kid, parent_headers)
    assert db.query(KidEnrollToken).filter_by(kid_id=sis.id).one().used_at is None


def test_kid_cannot_issue_403(client, kid, kid_headers, cfg):
    assert _issue(client, kid, kid_headers).status_code == 403
    assert client.get(f"{URL}/{kid.id}/phones", headers=kid_headers).status_code == 403
    assert client.delete(f"{URL}/{kid.id}/phones/1", headers=kid_headers).status_code == 403


def test_unauthenticated_401(client, kid, cfg):
    assert client.post(f"{URL}/{kid.id}/enroll").status_code == 401
    assert client.get(f"{URL}/{kid.id}/phones").status_code == 401


def test_unknown_kid_404(client, kid, parent, parent_headers, db, cfg):
    assert client.post(f"{URL}/9999/enroll", headers=parent_headers).status_code == 404
    assert _issue(client, parent, parent_headers).status_code == 404  # not a kid
    assert client.get(f"{URL}/{parent.id}/phones", headers=parent_headers).status_code == 404
    assert db.query(KidEnrollToken).count() == 0


def test_no_box_url_409(client, kid, parent_headers, db, monkeypatch):
    monkeypatch.setattr(settings, "BOX_URL", None)
    r = _issue(client, kid, parent_headers)
    assert r.status_code == 409 and r.json()["detail"] == "Set BOX_URL on the box first."
    assert db.query(KidEnrollToken).count() == 0


def test_list_and_remove_phone(client, kid, parent_headers, db, cfg):
    old = _phone(db, kid, "Old", "a" * 64, age=10)
    new = _phone(db, kid, "New", "b" * 64)
    r = client.get(f"{URL}/{kid.id}/phones", headers=parent_headers)
    assert r.status_code == 200
    rows = r.json()
    assert [p["id"] for p in rows] == [new.id, old.id]
    assert set(rows[0]) == {"id", "label", "created_at", "last_seen_at"}
    assert rows[0]["created_at"].endswith("Z") and rows[0]["last_seen_at"].endswith("Z")
    assert "b" * 64 not in r.text
    assert (
        client.delete(f"{URL}/{kid.id}/phones/{new.id}", headers=parent_headers).status_code == 204
    )
    assert db.query(KidDevice).filter_by(id=new.id).first() is None
    assert (
        client.delete(f"{URL}/{kid.id}/phones/{old.id}", headers=parent_headers).status_code == 204
    )
    assert client.get(f"{URL}/{kid.id}/phones", headers=parent_headers).json() == []


def test_remove_other_kids_phone_404(client, kid, parent_headers, db, cfg):
    sis = _sis(db)
    p = _phone(db, sis)
    r = client.delete(f"{URL}/{kid.id}/phones/{p.id}", headers=parent_headers)
    assert r.status_code == 404 and r.json()["detail"] == "We couldn't find that phone."
    assert db.query(KidDevice).filter_by(id=p.id).one()
    assert client.delete(f"{URL}/{kid.id}/phones/9999", headers=parent_headers).status_code == 404
