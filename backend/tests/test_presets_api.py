"""Presets API: catalog, preview, apply."""

from app.models.chores import Chore
from app.models.family import get_family
from app.models.user import UserRole

from tests.conftest import _make_user

URL = "/api/v1/presets"


def _kid(db, name="ivy", age="kid"):
    k = _make_user(db, name, UserRole.KID)
    k.age_group = age
    db.commit()
    return k


def test_catalog_shape(client, db, parent_headers):
    k = _kid(db)
    r = client.get(URL, headers=parent_headers)
    assert r.status_code == 200
    d = r.json()
    assert d["style"] is None
    assert d["kids"] == [{"id": k.id, "name": k.full_name, "age_group": "kid", "style": None}]
    assert d["plans"]["kid"]["strict"]["screen"] == 60
    assert d["family"]["strict"] == {"banked": False, "goals": True, "penalties": True}


def test_kid_token_is_forbidden(client, db, kid_headers):
    for m, u in (("get", URL), ("post", URL + "/preview"), ("post", URL + "/apply")):
        assert getattr(client, m)(u, headers=kid_headers).status_code == 403


def test_bad_style_and_skip_are_422(client, db, parent_headers):
    for body in ({"style": "wild"}, {"skip": ["nope"]}, {"kids": {"1": "wild"}}):
        assert client.post(URL + "/preview", json=body, headers=parent_headers).status_code == 422


def test_unknown_kid_is_404(client, db, parent_headers):
    r = client.post(URL + "/apply", json={"kids": {"999": "strict"}}, headers=parent_headers)
    assert r.status_code == 404


def test_preview_writes_nothing(client, db, parent_headers):
    _kid(db)
    r = client.post(URL + "/preview", json={"style": "strict"}, headers=parent_headers)
    assert r.status_code == 200 and r.json()["changes"]
    assert db.query(Chore).count() == 0 and get_family(db).preset_style is None


def test_apply_then_again_has_no_changes(client, db, parent_headers):
    k = _kid(db)
    r = client.post(URL + "/apply", json={"style": "strict"}, headers=parent_headers)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["style"] == "strict" and d["kept"] == []
    assert d["kids"] == [{"id": k.id, "name": k.full_name, "age_group": "kid", "style": "strict"}]
    assert {"kid_id", "who", "key", "now", "next"} == set(d["changes"][0])
    assert client.get(URL, headers=parent_headers).json()["style"] == "strict"
    again = client.post(URL + "/apply", json={"style": "strict"}, headers=parent_headers).json()
    assert again["changes"] == []
