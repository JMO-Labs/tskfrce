from datetime import date, datetime, timedelta

import pytest
from app.models.user import User
from sqlalchemy.exc import IntegrityError

from tests.test_suggestions import _get, _quiet

K = "/api/v1/kids"


def _kid(db, group, born=None, set_ago=None, created_ago=30):
    k = db.query(User).filter(User.username == "timmy").one()
    k.age_group = group
    k.birth_year, k.birth_month = born if born else (None, None)
    k.created_at = datetime.utcnow() - timedelta(days=created_ago)
    k.age_group_set_at = datetime.utcnow() - timedelta(days=set_ago) if set_ago else None
    db.commit()
    return k


def _born(years, days_to_go=0):
    """Birth (year, month) so the kid turns `years` in `days_to_go` days (month start)."""
    d = date.today() + timedelta(days=days_to_go)
    d = d.replace(day=1)
    return (d.year - years, d.month)


def _age_up(client, h):
    return [i for i in _get(client, h)["items"] if i["rule"] == "kid.age_up"]


def test_birth_both_or_neither(db, kid):
    kid.birth_month = 5
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


@pytest.mark.parametrize("m,y", [(0, 2015), (13, 2015), (5, 1800)])
def test_birth_ranges(db, kid, m, y):
    kid.birth_month, kid.birth_year = m, y
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_api_sets_and_clears_birth(client, parent_headers, kid):
    r = client.patch(
        f"{K}/{kid.id}", json={"birth_month": 4, "birth_year": 2016}, headers=parent_headers
    )
    assert r.json()["birth_month"] == 4 and r.json()["birth_year"] == 2016
    r = client.patch(
        f"{K}/{kid.id}", json={"birth_month": None, "birth_year": None}, headers=parent_headers
    )
    assert r.json()["birth_month"] is None
    r = client.patch(f"{K}/{kid.id}", json={"birth_month": 4}, headers=parent_headers)
    assert r.status_code == 422


def test_create_with_birth(client, parent_headers):
    r = client.post(
        K, json={"full_name": "Ann", "birth_month": 2, "birth_year": 2018}, headers=parent_headers
    )
    assert r.json()["birth_year"] == 2018


def test_fires_within_30_days_of_band(db, client, parent, kid, parent_headers):
    _quiet(db, parent, kid)
    _kid(db, "little", born=_born(9, 20))
    [s] = _age_up(client, parent_headers)
    assert "Kid" in s["action"]["label"] and s["action"]["to"].endswith(f"/kids/{kid.id}/age-up")


def test_quiet_when_far_from_band(db, client, parent, kid, parent_headers):
    _quiet(db, parent, kid)
    _kid(db, "little", born=_born(9, 90))
    assert _age_up(client, parent_headers) == []


def test_dob_wins_over_time_in_group(db, client, parent, kid, parent_headers):
    _quiet(db, parent, kid)
    _kid(db, "kid", born=_born(10), set_ago=365 * 6)
    assert _age_up(client, parent_headers) == []


def test_without_birth_after_four_years(db, client, parent, kid, parent_headers):
    _quiet(db, parent, kid)
    _kid(db, "kid", set_ago=365 * 4 + 5)
    assert len(_age_up(client, parent_headers)) == 1
    _kid(db, "kid", set_ago=365 * 3)
    assert _age_up(client, parent_headers) == []


def test_falls_back_to_created_at(db, client, parent, kid, parent_headers):
    _quiet(db, parent, kid)
    _kid(db, "little", created_ago=365 * 5)
    assert len(_age_up(client, parent_headers)) == 1


def test_teens_never(db, client, parent, kid, parent_headers):
    _quiet(db, parent, kid)
    _kid(db, "teen", set_ago=365 * 9)
    assert _age_up(client, parent_headers) == []
    _kid(db, "teen", born=_born(20))
    assert _age_up(client, parent_headers) == []


def test_confirm_moves_group_and_applies_preset(db, client, parent, kid, parent_headers):
    from app.models.family import get_family

    _kid(db, "kid", set_ago=365 * 5)
    get_family(db).preset_style = "balanced"
    db.commit()
    r = client.post(f"{K}/{kid.id}/age-up", headers=parent_headers)
    assert r.status_code == 200 and r.json()["age_group"] == "teen"
    db.refresh(kid)
    assert kid.age_group == "teen" and kid.age_group_set_at is not None
    assert (datetime.utcnow() - kid.age_group_set_at).days == 0
    assert client.post(f"{K}/{kid.id}/age-up", headers=parent_headers).status_code == 400


def test_no_birthday_without_month(db, kid):
    today = date.today()
    assert kid.is_birthday(today) is False
    kid.birth_month, kid.birth_year = today.month, today.year - 8
    assert kid.is_birthday(today) is True
    kid.birth_month = kid.birth_year = None
    kid.created_at = datetime.utcnow().replace(year=today.year - 3)
    assert kid.is_birthday(today) is False
