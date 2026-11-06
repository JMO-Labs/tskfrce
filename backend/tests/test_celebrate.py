"""Per-kid celebration level: full / small / off; null means the mode default."""

import pytest
from app.models.user import User
from sqlalchemy.exc import IntegrityError

from tests.conftest import _headers


@pytest.mark.parametrize("age,want", [("little", "full"), ("kid", "full"), ("teen", "small")])
def test_default_comes_from_age_group(client, db, kid, parent_headers, age, want):
    kid.age_group = age
    db.commit()
    assert kid.celebrate is None
    me = client.get("/api/v1/kid/today", headers=_headers(db, kid)).json()
    assert me["celebrate"] == want
    [row] = client.get("/api/v1/kids", headers=parent_headers).json()
    assert row["celebrate"] == want


def test_kid_sets_their_own(client, db, kid):
    kid.age_group = "teen"
    db.commit()
    h = _headers(db, kid)
    r = client.patch("/api/v1/kid/me", json={"celebrate": "off"}, headers=h)
    assert r.status_code == 200 and r.json()["celebrate"] == "off"
    assert client.get("/api/v1/kid/today", headers=h).json()["celebrate"] == "off"
    r = client.patch("/api/v1/kid/me", json={"celebrate": "full"}, headers=h)
    assert r.json()["celebrate"] == "full"
    db.refresh(kid)
    assert kid.celebrate == "full"


def test_kid_rejects_bad_value_and_parents(client, db, kid, parent_headers):
    h = _headers(db, kid)
    assert client.patch("/api/v1/kid/me", json={"celebrate": "loud"}, headers=h).status_code == 422
    r = client.patch("/api/v1/kid/me", json={"celebrate": "off"}, headers=parent_headers)
    assert r.status_code == 403


def test_parent_sets_any_kid(client, db, kid, parent_headers):
    r = client.patch(f"/api/v1/kids/{kid.id}", json={"celebrate": "small"}, headers=parent_headers)
    assert r.status_code == 200 and r.json()["celebrate"] == "small"
    me = client.get("/api/v1/kid/today", headers=_headers(db, kid)).json()
    assert me["celebrate"] == "small"
    bad = client.patch(f"/api/v1/kids/{kid.id}", json={"celebrate": "x"}, headers=parent_headers)
    assert bad.status_code == 422


def test_check_constraint(db, kid):
    with pytest.raises(IntegrityError):
        db.query(User).filter(User.id == kid.id).update({"celebrate": "loud"})
    db.rollback()


def test_null_clears_back_to_mode_default(client, db, kid, parent_headers):
    kid.age_group, kid.celebrate = "teen", "off"
    db.commit()
    r = client.patch(f"/api/v1/kids/{kid.id}", json={"full_name": "T"}, headers=parent_headers)
    assert r.json()["celebrate"] == "off"  # absent: unchanged
    r = client.patch(f"/api/v1/kids/{kid.id}", json={"celebrate": None}, headers=parent_headers)
    assert r.status_code == 200 and r.json()["celebrate"] == "small"
    db.refresh(kid)
    assert kid.celebrate is None
    h = _headers(db, kid)
    client.patch("/api/v1/kid/me", json={"celebrate": "off"}, headers=h)
    r = client.patch("/api/v1/kid/me", json={"celebrate": None}, headers=h)
    assert r.status_code == 200 and r.json()["celebrate"] == "small"
    db.refresh(kid)
    assert kid.celebrate is None
