"""Get out of jail free: a fulfilled jail goal is one card that cancels an active penalty."""

from datetime import UTC, datetime

from app.models.family import get_family
from app.models.goal import Goal
from app.models.inbox import Notification
from app.models.points import Points, PointsType
from app.models.user import UserRole
from app.services import penalties

from tests.conftest import _make_user

K = "/api/v1/kid/goals"


def _fam(db, **kw):
    fam = get_family(db)
    for k, v in kw.items():
        setattr(fam, k, v)
    db.commit()


def _card(db, parent, kid, **kw):
    g = Goal(
        name="Get out of jail free",
        kind="jail",
        kid_id=kid.id,
        target=500,
        status="fulfilled",
        created_by_id=parent.id,
        **kw,
    )
    db.add(g)
    db.commit()
    return g


def _penalty(db, parent, kid):
    db.add(Points(user_id=kid.id, points_type=PointsType.BONUS, amount=50, description="t"))
    db.commit()
    g = penalties.Give(kind="points", amount=20, earn_back="all")
    [p] = penalties.give(db, [kid.id], g, parent, datetime.now(UTC))
    return p


def _play(client, headers, pid):
    return client.post(f"{K}/jail/play", json={"penalty_id": pid}, headers=headers)


def test_cards_count_and_hidden_when_penalties_off(client, db, parent, kid, kid_headers):
    _fam(db, goals_on=True, goal_jail_on=True, penalties_enabled=True)
    _card(db, parent, kid)
    _card(db, parent, kid, played_at=datetime(2026, 1, 1))
    j = client.get(K, headers=kid_headers).json()
    assert j["cards"] == 1 and [b["kind"] for b in j["builtins"]] == ["jail"]
    _fam(db, penalties_enabled=False)
    j = client.get(K, headers=kid_headers).json()
    assert j["cards"] == 0 and j["builtins"] == []
    r = client.post(f"{K}/start", json={"kind": "jail"}, headers=kid_headers)
    assert r.status_code == 400


def test_fulfilled_jail_goal_gives_card(client, db, parent, kid, kid_headers, parent_headers):
    _fam(db, goals_on=True, goal_jail_on=True, penalties_enabled=True)
    g = client.post(f"{K}/start", json={"kind": "jail"}, headers=kid_headers).json()
    assert g["target"] == 500
    row = db.get(Goal, g["id"])
    row.status = "full"
    db.commit()
    assert (
        client.post(f"/api/v1/goals/{g['id']}/fulfill", headers=parent_headers).status_code == 200
    )
    assert client.get(K, headers=kid_headers).json()["cards"] == 1


def test_play_cancels_and_notifies(client, db, parent, kid, kid_headers):
    _fam(db, goals_on=True, penalties_enabled=True)
    c = _card(db, parent, kid)
    p = _penalty(db, parent, kid)
    r = _play(client, kid_headers, p.id)
    assert r.status_code == 200 and r.json()["cards"] == 0
    db.refresh(p)
    db.refresh(c)
    assert p.status == "cancelled" and c.played_at and c.penalty_id == p.id
    assert db.query(Points).filter(Points.penalty_id == p.id).count() == 0  # refunded
    n = db.query(Notification).filter(Notification.kind == "jail_card").all()
    assert len(n) >= 1


def test_play_no_card_409(client, db, parent, kid, kid_headers):
    _fam(db, goals_on=True, penalties_enabled=True)
    p = _penalty(db, parent, kid)
    assert _play(client, kid_headers, p.id).status_code == 409
    db.refresh(p)
    assert p.status == "active"


def test_play_penalties_off_400(client, db, parent, kid, kid_headers):
    _fam(db, goals_on=True, penalties_enabled=True)
    _card(db, parent, kid)
    p = _penalty(db, parent, kid)
    _fam(db, penalties_enabled=False)
    assert _play(client, kid_headers, p.id).status_code == 400


def test_play_other_kids_penalty_404(client, db, parent, kid, kid_headers):
    _fam(db, goals_on=True, penalties_enabled=True)
    _card(db, parent, kid)
    sis = _make_user(db, "sis", UserRole.KID)
    p = _penalty(db, parent, sis)
    assert _play(client, kid_headers, p.id).status_code == 404
    assert _play(client, kid_headers, 9999).status_code == 404
    db.refresh(p)
    assert p.status == "active"


def test_play_inactive_penalty_409_and_card_kept(client, db, parent, kid, kid_headers):
    _fam(db, goals_on=True, penalties_enabled=True)
    c = _card(db, parent, kid)
    p = _penalty(db, parent, kid)
    p.status, p.ended_at = "ended", datetime(2020, 1, 1)
    db.commit()
    assert _play(client, kid_headers, p.id).status_code == 409
    db.refresh(c)
    assert c.played_at is None


def test_card_plays_once(client, db, parent, kid, kid_headers):
    _fam(db, goals_on=True, penalties_enabled=True)
    _card(db, parent, kid)
    p1, p2 = _penalty(db, parent, kid), _penalty(db, parent, kid)
    assert _play(client, kid_headers, p1.id).status_code == 200
    assert _play(client, kid_headers, p2.id).status_code == 409


def test_parent_cannot_play(client, db, parent, kid, parent_headers):
    _fam(db, goals_on=True, penalties_enabled=True)
    _card(db, parent, kid)
    p = _penalty(db, parent, kid)
    assert _play(client, parent_headers, p.id).status_code in (401, 403)


def test_card_works_on_just_ended_points_penalty(client, db, parent, kid, kid_headers):
    _fam(db, goals_on=True, penalties_enabled=True)
    _card(db, parent, kid)
    db.add(Points(user_id=kid.id, points_type=PointsType.BONUS, amount=50, description="t"))
    db.commit()
    g = penalties.Give(kind="points", amount=20, earn_back="none")
    [p] = penalties.give(db, [kid.id], g, parent, datetime.now(UTC))
    assert p.status == "ended"
    assert _play(client, kid_headers, p.id).status_code == 200


def test_kid_today_carries_card_count(client, db, parent, kid, kid_headers):
    _fam(db, goals_on=True, penalties_enabled=True)
    _card(db, parent, kid)
    assert client.get("/api/v1/kid/today", headers=kid_headers).json()["jail_cards"] == 1
