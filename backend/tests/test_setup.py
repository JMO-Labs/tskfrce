import pytest
from app.api.deps import require_parent
from app.models.family import get_family
from app.models.user import User, UserRole
from fastapi import HTTPException

from tests.conftest import _headers, _make_user

BODY = {
    "family_name": "Sotos",
    "timezone": "America/New_York",
    "parent": {"username": "rich", "password": "s3cret-pw", "full_name": "Rich Soto"},
}


def test_setup_needed_on_empty_db(client):
    assert client.get("/api/v1/setup").json() == {"needed": True, "claim": False}


def test_setup_creates_owner_parent_and_family(client, db):
    r = client.post("/api/v1/setup", json=BODY)
    assert r.status_code == 201
    assert r.json()["access_token"]
    assert r.json()["refresh_token"]
    assert r.json()["token_type"] == "bearer"
    assert r.json()["expires_in"] > 0
    u = db.query(User).one()
    assert u.role == UserRole.PARENT
    fam = get_family(db)
    assert (fam.name, fam.timezone, fam.owner_id) == ("Sotos", "America/New_York", u.id)
    assert client.get("/api/v1/setup").json() == {"needed": False, "claim": False}


def test_setup_twice_returns_409(client):
    client.post("/api/v1/setup", json=BODY)
    r = client.post("/api/v1/setup", json=BODY)
    assert r.status_code == 409
    assert r.json()["detail"] == "Setup is already done. Log in instead."


def test_require_parent_rejects_kid(kid, parent):
    with pytest.raises(HTTPException) as e:
        require_parent(kid)
    assert e.value.status_code == 403
    assert require_parent(parent) is parent


def test_setup_works_when_family_row_pre_exists(client, db):
    get_family(db)
    db.commit()
    assert client.get("/api/v1/setup").json() == {"needed": True, "claim": False}
    assert client.post("/api/v1/setup", json=BODY).status_code == 201
    assert get_family(db).name == "Sotos"


def test_setup_409_when_owner_already_set(client, db):
    owner = User(username="own", email="o@x.local", hashed_password="x", role=UserRole.PARENT)
    db.add(owner)
    db.flush()
    get_family(db).owner_id = owner.id
    db.commit()
    assert client.get("/api/v1/setup").json() == {"needed": False, "claim": False}
    assert client.post("/api/v1/setup", json=BODY).status_code == 409
    assert db.query(User).count() == 1


def test_role_aliases_resolve_to_parent_kid():
    assert UserRole.ADMIN is UserRole.PARENT
    assert UserRole.ORGANIZER is UserRole.PARENT
    assert UserRole.USER is UserRole.KID


@pytest.mark.parametrize(
    "patch",
    [
        {"timezone": "Mars/Base"},
        {"parent": {**BODY["parent"], "password": "short"}},
        {"parent": {**BODY["parent"], "username": "bad name!"}},
        {"parent": {**BODY["parent"], "full_name": "x" * 101}},
    ],
)
def test_setup_validates_input(client, patch):
    assert client.post("/api/v1/setup", json={**BODY, **patch}).status_code == 422


def _tok(client):
    t = client.post("/api/v1/setup", json=BODY).json()["access_token"]
    return {"Authorization": f"Bearer {t}"}


def test_setup_step_resumes_after_account(client, db):
    h = _tok(client)
    assert get_family(db).setup_step == 3
    assert client.get("/api/v1/setup/step", headers=h).json() == {"step": 3}
    assert client.put("/api/v1/setup/step", json={"step": 5}, headers=h).json() == {"step": 5}
    assert client.get("/api/v1/setup/step", headers=h).json() == {"step": 5}
    assert client.put("/api/v1/setup/step", json={"step": None}, headers=h).status_code == 200
    assert client.get("/api/v1/setup/step", headers=h).json() == {"step": None}


def test_setup_step_validates_and_is_parent_only(client, db):
    h = _tok(client)
    kid = _headers(db, _make_user(db, "kiddo", UserRole.KID))
    assert client.put("/api/v1/setup/step", json={"step": 1}, headers=h).status_code == 422
    assert client.put("/api/v1/setup/step", json={"step": 9}, headers=h).status_code == 422
    assert client.get("/api/v1/setup/step").status_code == 401
    assert client.put("/api/v1/setup/step", json={"step": 4}, headers=kid).status_code == 403


def test_extras_step_7_is_saved_and_resumed(client, db):
    h = _tok(client)
    assert client.put("/api/v1/setup/step", json={"step": 7}, headers=h).status_code == 200
    assert client.get("/api/v1/setup/step", headers=h).json() == {"step": 7}


def test_stored_step_above_last_reads_as_finished(client, db):
    h = _tok(client)
    get_family(db).setup_step = 9
    db.commit()
    assert client.get("/api/v1/setup/step", headers=h).json() == {"step": None}


def test_finished_setup_step_is_locked(client, db):
    h = _tok(client)
    assert client.put("/api/v1/setup/step", json={"step": None}, headers=h).status_code == 200
    r = client.put("/api/v1/setup/step", json={"step": 5}, headers=h)
    assert r.status_code == 409 and r.json()["detail"] == "Setup is already finished."
    assert get_family(db).setup_step is None
    assert client.put("/api/v1/setup/step", json={"step": None}, headers=h).status_code == 200


def test_username_available_before_setup(client):
    """Username check works before setup is complete."""
    r = client.get("/api/v1/setup/username-available?u=alice")
    assert r.status_code == 200
    assert r.json() == {"available": True}


def test_username_taken_during_setup(client, db):
    """Username check detects taken usernames."""
    client.post("/api/v1/setup", json=BODY)
    r = client.get("/api/v1/setup/username-available?u=rich")
    assert r.status_code == 200
    assert r.json() == {"available": False}


def test_username_available_new_one_during_setup(client, db):
    """Username check works for new usernames after setup."""
    client.post("/api/v1/setup", json=BODY)
    r = client.get("/api/v1/setup/username-available?u=alice")
    assert r.status_code == 200
    assert r.json() == {"available": True}


def test_username_check_after_setup_done(client, db):
    """Username check blocked after setup is completely done."""
    client.post("/api/v1/setup", json=BODY)
    get_family(db).setup_step = None
    db.commit()
    r = client.get("/api/v1/setup/username-available?u=bob")
    assert r.status_code == 409


def test_username_validation_rules(client):
    """Username check validates format."""
    # Too short
    r = client.get("/api/v1/setup/username-available?u=ab")
    assert r.json() == {"available": False}
    # Too long
    r = client.get("/api/v1/setup/username-available?u=" + "a" * 51)
    assert r.json() == {"available": False}
    # Invalid chars
    r = client.get("/api/v1/setup/username-available?u=alice@home")
    assert r.json() == {"available": False}
    # Empty
    r = client.get("/api/v1/setup/username-available?u=")
    assert r.json() == {"available": False}
