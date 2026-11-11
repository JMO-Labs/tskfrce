import random
from datetime import datetime, timedelta

import pytest
from app.models.family import get_family
from app.models.game import GamePlay, GamePowerUp, GameProgress
from app.services import games_catalog as gc
from app.services import minigames
from app.services import minigames_play as mp
from app.services import minigames_power as pw
from fastapi import HTTPException

from tests.test_games_play import NOW, _saved, _started

G = "/api/v1/kid/games"


class Rng:
    def __init__(self, r):
        self.r = r

    def random(self):
        return self.r


@pytest.fixture(autouse=True)
def _awake(monkeypatch):
    monkeypatch.setattr(minigames, "asleep_until", lambda db, fam, kid, now: None)


def test_new_games():
    for k in ("math-dash", "pack-the-box", "shelf-memory"):
        assert gc.GAMES[k].kind == "think" and k in gc.eligible_think("little")
        assert len(gc.UPGRADES[k]) == 3 and len(gc.POWER_UPS[k]) == 2
    assert gc.stars_for("math-dash", 20) == 2
    assert gc.stars_for("pack-the-box", 7) == 3
    assert gc.check_score("shelf-memory", 80, 120)
    assert not gc.check_score("shelf-memory", 81, 120)
    for age in gc.ALL_AGES:
        seen = {gc.pick(age, random.Random(s))[0] for s in range(300)}
        assert {"math-dash", "pack-the-box", "shelf-memory"} <= seen
        for s in range(50):
            g, slots, i = gc.pick(age, random.Random(s))
            assert slots[i] == g


def test_thresholds():
    assert gc.upgrades_for("hungry-cat", 5) == []
    assert gc.upgrades_for("hungry-cat", 6) == ["slow_start"]
    assert gc.upgrades_for("hungry-cat", 15) == ["slow_start", "big_bowl"]
    assert gc.upgrades_for("quickfire", 30)[-1] == "calm_start"
    assert gc.upgrades_for("qf:flip", 4) == []
    assert gc.upgrades_for("qf:flip", 5) == ["extra_time"]
    assert gc.upgrades_for("qf:flip", 30) == ["extra_time", "slow_start", "steady"]
    assert gc.next_upgrade("hungry-cat", 5) == {"name": "Slower food", "have": 5, "need": 6}
    assert gc.next_upgrade("hungry-cat", 6)["name"] == "Bigger bowl"
    assert gc.next_upgrade("hungry-cat", 30) is None


def test_held_and_use(db, kid):
    assert pw.held(db, kid.id, "hungry-cat") == []
    db.add(GamePowerUp(kid_id=kid.id, game="hungry-cat", key="magnet", won_at=datetime.utcnow()))
    db.commit()
    assert pw.held(db, kid.id, "hungry-cat") == [{"key": "magnet", "name": "Magnet", "icon": "🧲"}]
    assert pw.held(db, kid.id, "math-dash") == []
    assert pw.use(db, kid.id, "hungry-cat", "freeze") is False
    assert pw.use(db, kid.id, "hungry-cat", "magnet") is True
    assert pw.use(db, kid.id, "hungry-cat", "magnet") is False


def test_award_odds_and_cap(db, kid):
    assert pw.maybe_award(db, kid.id, "hungry-cat", Rng(0.5)) is None
    got = pw.maybe_award(db, kid.id, "hungry-cat", Rng(0.2))
    assert got["key"] in ("magnet", "multiply")
    assert pw.maybe_award(db, kid.id, "math-dash", Rng(0.2)) is not None
    assert pw.maybe_award(db, kid.id, "pack-the-box", Rng(0.2)) is None  # 2 held
    assert db.query(GamePowerUp).filter_by(kid_id=kid.id).count() == 2


def test_start_has_upgrades(db, kid):
    db.add_all(
        [
            GameProgress(kid_id=kid.id, game="hungry-cat", stars_total=7),
            GameProgress(kid_id=kid.id, game="qf:flip", clears=5),
            GameProgress(kid_id=kid.id, game="qf:zip", clears=2),
            GameProgress(kid_id=kid.id, game="quickfire", stars_total=6),
            GamePowerUp(kid_id=kid.id, game="hungry-cat", key="magnet", won_at=NOW),
        ]
    )
    _saved(db, kid)
    out = mp.start(db, get_family(db), kid, NOW, rng=random.Random(1))
    if out["game"] == "quickfire":
        assert out["upgrades"] == ["extra_time"]
        assert out["micro_upgrades"] == {"flip": ["extra_time"]}
        assert out["power_ups"] == []
    else:
        assert out["upgrades"] == ["slow_start"]
        assert "micro_upgrades" not in out
        assert out["power_ups"][0]["key"] == "magnet"


def test_finish_unknown_power_up_422_keeps_play(db, kid):
    _started(db, kid, "hungry-cat", secs=30)
    with pytest.raises(HTTPException) as e:
        mp.finish(db, get_family(db), kid, "tok", 20, None, NOW, power_up="magnet")
    assert e.value.status_code == 422
    assert db.query(GamePlay).filter_by(token="tok").one().status == "started"


def test_finish_consumes_and_reports(db, kid):
    db.add(GamePowerUp(kid_id=kid.id, game="hungry-cat", key="magnet", won_at=NOW))
    db.add(GameProgress(kid_id=kid.id, game="hungry-cat", stars_total=5, rounds=3))
    _started(db, kid, "hungry-cat", secs=30)
    out = mp.finish(db, get_family(db), kid, "tok", 20, None, NOW, power_up="magnet", rng=Rng(0.9))
    assert db.query(GamePowerUp).filter_by(kid_id=kid.id).count() == 0
    assert out["unlocked"] == "Slower food"  # 5 + 1 star = 6
    assert out["upgrade"] == {"name": "Bigger bowl", "have": 6, "need": 15}
    assert out["bonus"] is None


def test_finish_awards_bonus(db, kid):
    _started(db, kid, "hungry-cat", secs=30)
    out = mp.finish(db, get_family(db), kid, "tok", 20, None, NOW, rng=Rng(0.1))
    assert out["bonus"]["key"] in ("magnet", "multiply")
    assert out["unlocked"] is None
    assert len(pw.held(db, kid.id, "hungry-cat")) == 1


def test_invalid_round_no_award(db, kid):
    _started(db, kid, "hungry-cat", secs=1)
    with pytest.raises(HTTPException):
        mp.finish(db, get_family(db), kid, "tok", 250, None, NOW, rng=Rng(0.1))
    assert db.query(GamePowerUp).count() == 0


def test_shelf_upgrades_count(db, kid):
    db.add(GameProgress(kid_id=kid.id, game="hungry-cat", stars_total=15))
    db.commit()
    games = {g["key"]: g for g in mp.shelf(db, get_family(db), kid, NOW)["games"]}
    assert games["hungry-cat"]["upgrades"] == 2 and games["math-dash"]["upgrades"] == 0


def test_api_power_up_flow(client, db, kid, kid_headers):
    db.add(GamePowerUp(kid_id=kid.id, game="hungry-cat", key="magnet", won_at=datetime.utcnow()))
    _saved(db, kid)
    p = _started(db, kid, "hungry-cat", secs=30)
    p.started_at = datetime.utcnow() - timedelta(seconds=30)
    db.commit()
    bad = client.post(
        f"{G}/finish", json={"token": "tok", "score": 20, "power_up": "freeze"}, headers=kid_headers
    )
    assert bad.status_code == 422
    ok = client.post(
        f"{G}/finish", json={"token": "tok", "score": 20, "power_up": "magnet"}, headers=kid_headers
    )
    assert ok.status_code == 200
    assert {"upgrade", "unlocked", "bonus"} <= ok.json().keys()
    assert db.query(GamePowerUp).filter_by(kid_id=kid.id, key="magnet").count() == 0


def test_migration_round_trip(tmp_path):
    import os
    import subprocess
    import sys

    from sqlalchemy import create_engine, inspect

    url = f"sqlite:///{tmp_path / 'p2.db'}"
    env = {**os.environ, "DATABASE_URL": url}
    backend = os.path.dirname(os.path.dirname(__file__))

    def alembic(*a):
        subprocess.run([sys.executable, "-m", "alembic", *a], cwd=backend, env=env, check=True)

    alembic("upgrade", "head")
    assert "game_power_ups" in inspect(create_engine(url)).get_table_names()
    alembic("downgrade", "a2m3n4o5p6q7")
    assert "game_power_ups" not in inspect(create_engine(url)).get_table_names()
    alembic("upgrade", "head")
