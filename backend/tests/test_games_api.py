from datetime import UTC, datetime, timedelta

import pytest
from app.models.game import GamePlay
from app.services import minigames

from tests.factories import make_run

G = "/api/v1/kid/games"


@pytest.fixture(autouse=True)
def _awake(monkeypatch):
    """These tests use the real clock; the asleep window has its own tests."""
    monkeypatch.setattr(minigames, "asleep_until", lambda fam, now: None)


def _saved(db, kid, n=1, seen=False):
    for _ in range(n):
        db.add(
            GamePlay(
                kid_id=kid.id,
                earned_day=datetime.now(UTC).date(),
                earned_at=datetime.utcnow(),
                seen=seen,
            )
        )
    db.commit()


def test_shelf_kid_and_preview(client, db, kid, kid_headers, parent_headers):
    _saved(db, kid, 2)
    r = client.get(G, headers=kid_headers)
    assert r.status_code == 200
    j = r.json()
    assert (j["on"], j["saved"], j["fresh"], j["started"]) == (True, 2, 2, None)
    assert j["board"]["rows"][0]["me"] is True
    p = client.get(G, headers={**parent_headers, "X-View-As": str(kid.id)})
    assert p.status_code == 200 and p.json()["saved"] == 2


def test_parent_cannot_start(client, db, kid, parent_headers):
    _saved(db, kid)
    h = {**parent_headers, "X-View-As": str(kid.id)}
    assert client.post(f"{G}/start", json={}, headers=h).status_code == 403


def test_start_finish_flow(client, db, kid, kid_headers):
    _saved(db, kid, 2)
    s = client.post(f"{G}/start", json={}, headers=kid_headers)
    assert s.status_code == 200, s.text
    st = s.json()
    play = db.get(GamePlay, st["play_id"])
    play.started_at = datetime.utcnow() - timedelta(seconds=40)
    db.commit()
    if st["game"] == "quickfire":
        body = {
            "token": st["token"],
            "score": 0,
            "parts": [{"game": "flip", "ok": True, "ms": 600}] * 5,
        }
    else:
        body = {"token": st["token"], "score": 12, "parts": None}
    f = client.post(f"{G}/finish", json=body, headers=kid_headers)
    assert f.status_code == 200, f.text
    assert f.json()["saved"] == 1
    assert client.post(f"{G}/finish", json=body, headers=kid_headers).status_code == 404
    assert client.get("/api/v1/kid/today", headers=kid_headers).json()["games"] == {
        "on": True,
        "saved": 1,
        "fresh": 1,
    }


def test_seen(client, db, kid, kid_headers):
    _saved(db, kid, 2)
    assert client.post(f"{G}/seen", headers=kid_headers).status_code == 204
    assert client.get(G, headers=kid_headers).json()["fresh"] == 0


def test_family_switches(client, parent_headers, db):
    assert (
        client.patch(
            "/api/v1/family", json={"games_cap_pct": 60}, headers=parent_headers
        ).status_code
        == 422
    )
    assert (
        client.patch(
            "/api/v1/family", json={"games_earn": "bogus"}, headers=parent_headers
        ).status_code
        == 422
    )
    r = client.patch(
        "/api/v1/family",
        json={"games_earn": "custom", "games_board": False},
        headers=parent_headers,
    )
    assert r.status_code == 200
    j = client.get("/api/v1/family", headers=parent_headers).json()
    assert (
        j["games_on"],
        j["games_earn"],
        j["games_cap_pct"],
        j["games_board"],
        j["games_rounds"],
    ) == (
        True,
        "custom",
        10,
        False,
        0,
    )


def test_kid_switch(client, kid, kid_headers, parent_headers):
    r = client.patch(f"/api/v1/kids/{kid.id}", json={"games_on": False}, headers=parent_headers)
    assert r.json()["games_on"] is False
    assert client.get("/api/v1/kid/today", headers=kid_headers).json()["games"]["on"] is False
    assert client.get("/api/v1/kids", headers=parent_headers).json()[0]["games_on"] is False


def test_chore_gives_game(client, parent_headers):
    r = client.post(
        "/api/v1/chores/", json={"title": "Mop", "gives_game": True}, headers=parent_headers
    )
    assert r.json()["gives_game"] is True
    cid = r.json()["id"]
    assert (
        client.patch(
            f"/api/v1/chores/{cid}", json={"gives_game": False}, headers=parent_headers
        ).json()["gives_game"]
        is False
    )
    assert (
        client.post("/api/v1/chores/", json={"title": "x"}, headers=parent_headers).json()[
            "gives_game"
        ]
        is False
    )


def test_delete_kid_with_games(client, db, parent, kid, parent_headers):
    _saved(db, kid)
    make_run(db, parent, kid)
    assert client.delete(f"/api/v1/kids/{kid.id}", headers=parent_headers).status_code in (200, 204)
