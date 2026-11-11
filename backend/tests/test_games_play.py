from datetime import UTC, date, datetime, timedelta

import pytest
from app.models.family import get_family
from app.models.game import GamePlay, GameProgress
from app.models.points import Points, PointsType
from app.models.user import UserRole
from app.services import games_catalog as gc
from app.services import minigames_play as mp
from fastapi import HTTPException

from tests.conftest import _make_user
from tests.factories import make_rule, make_run

DAY = date(2026, 10, 20)
NOW = datetime(2026, 10, 21, 12, 0, tzinfo=UTC)


def _chore_pts(db, parent, kid, pts, day=DAY):
    r = make_run(db, parent, kid, status="done", day=day)
    db.add(
        Points(
            user_id=kid.id,
            points_type=PointsType.TASK_COMPLETION,
            amount=pts,
            reason="chore",
            run_id=r.id,
        )
    )
    db.commit()


def _saved(db, kid, day=DAY, n=1):
    for _ in range(n):
        db.add(GamePlay(kid_id=kid.id, earned_day=day, earned_at=datetime(2026, 10, 20, 9, 0)))
    db.commit()


def _started(db, kid, game="quickfire", secs=30, token="tok", day=DAY):
    p = GamePlay(
        kid_id=kid.id,
        earned_day=day,
        earned_at=datetime(2026, 10, 20, 9, 0),
        status="started",
        token=token,
        game=game,
        level=2,
        slot=0,
        started_at=NOW.replace(tzinfo=None) - timedelta(seconds=secs),
    )
    db.add(p)
    db.commit()
    return p


def _parts(n=10, ms=600):
    return [{"game": "sock-snatch", "ok": True, "ms": ms} for _ in range(n)]


def test_start_without_saved(db, kid):
    with pytest.raises(HTTPException) as e:
        mp.start(db, get_family(db), kid, NOW)
    assert (e.value.status_code, e.value.detail) == (
        409,
        "No saved games. Finish a chore to earn one.",
    )


def test_start_off(db, kid):
    kid.games_on = False
    with pytest.raises(HTTPException) as e:
        mp.start(db, get_family(db), kid, NOW)
    assert (e.value.status_code, e.value.detail) == (403, "Games are off.")


def test_start_twice_same_token(db, kid):
    _saved(db, kid, n=2)
    a = mp.start(db, get_family(db), kid, NOW)
    b = mp.start(db, get_family(db), kid, NOW)
    assert a == b and len(a["slots"]) == 6 and a["slots"][a["slot"]] == a["game"]
    assert a["level"] == 2 and a["kind"] in ("quick", "think")
    assert db.query(GamePlay).filter_by(status="saved").count() == 1


def test_start_asleep(db, kid):
    _saved(db, kid)
    fam = get_family(db)
    fam.reset_time = "06:00"
    make_rule(db, kid_ids=[kid.id], times=(("07:00", "21:00"),))
    with pytest.raises(HTTPException) as e:
        mp.start(db, fam, kid, datetime(2026, 10, 20, 22, 30, tzinfo=UTC))
    assert (e.value.status_code, e.value.detail) == (409, "Games are asleep until 6:00 AM.")


def test_finish_quick_pays_once(db, parent, kid):
    _chore_pts(db, parent, kid, 30)
    _started(db, kid)
    fam = get_family(db)
    out = mp.finish(db, fam, kid, "tok", 0, _parts(), NOW)
    assert (out["score"], out["stars"], out["tickets"], out["points"]) == (1400, 2, 6, 3)
    assert out["capped"] is True and out["new_best"] is True and out["best"] == 1400
    assert db.query(Points).filter_by(reason="game").one().amount == 3
    assert db.get(GameProgress, (kid.id, "quickfire")).rounds == 1
    assert db.get(GameProgress, (kid.id, "qf:sock-snatch")).clears == 10
    with pytest.raises(HTTPException) as e:
        mp.finish(db, fam, kid, "tok", 0, _parts(), NOW)
    assert (e.value.status_code, e.value.detail) == (404, "That game already ended.")
    assert db.query(Points).filter_by(reason="game").count() == 1


def test_finish_impossible(db, kid):
    p = _started(db, kid, game="hungry-cat", secs=10)
    with pytest.raises(HTTPException) as e:
        mp.finish(db, get_family(db), kid, "tok", 500, None, NOW)
    assert (e.value.status_code, e.value.detail) == (422, "That score isn't possible.")
    db.refresh(p)
    assert (p.status, p.points, p.stars) == ("done", 0, 0)
    with pytest.raises(HTTPException) as e:
        mp.finish(db, get_family(db), kid, "tok", 5, None, NOW)
    assert e.value.status_code == 404


def test_finish_uses_earned_day_cap(db, parent, kid):
    _chore_pts(db, parent, kid, 30, DAY)
    _chore_pts(db, parent, kid, 100, DAY + timedelta(days=1))
    _started(db, kid, day=DAY)
    out = mp.finish(db, get_family(db), kid, "tok", 0, _parts(), NOW)
    assert out["points"] == 3


def test_shelf_board(db, parent, kid):
    fam = get_family(db)
    sib = _make_user(db, "sis", UserRole.KID)
    teen = _make_user(db, "tee", UserRole.KID)
    teen.age_group = "teen"
    _started(db, kid)
    mp.finish(db, fam, kid, "tok", 0, _parts(), NOW)
    _started(db, sib, token="t2", game="hungry-cat", secs=30)
    mp.finish(db, fam, sib, "t2", 12, None, NOW)
    _started(db, teen, token="t3")
    mp.finish(db, fam, teen, "t3", 0, _parts(), NOW)
    s = mp.shelf(db, fam, kid, NOW)
    assert (
        s["on"] is True and s["saved"] == 0 and s["started"] is None and s["asleep_until"] is None
    )
    assert s["board"]["band"] == "kid"
    assert [(r["name"], r["stars"], r["me"]) for r in s["board"]["rows"]] == [
        ("Timmy", 2, True),
        ("Sis", 1, False),
    ]
    assert s["family_rounds"] == 3
    assert {g["key"] for g in s["games"]} == set(gc.GAMES)
    assert s["cap"]["max"] >= 1
    fam.games_board = False
    assert mp.shelf(db, fam, kid, NOW)["board"] is None
