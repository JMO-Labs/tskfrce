from datetime import UTC, date, datetime

import pytest
from app.models.family import get_family
from app.models.game import GamePlay, GameProgress
from app.models.points import Points, PointsType
from sqlalchemy.exc import IntegrityError


def _play(kid, **kw):
    return GamePlay(kid_id=kid.id, earned_day=date(2026, 10, 20), earned_at=datetime.now(UTC), **kw)


def test_defaults(db, kid):
    fam = get_family(db)
    p = _play(kid)
    db.add_all([p, GameProgress(kid_id=kid.id, game="quickfire")])
    db.commit()
    assert (fam.games_on, fam.games_earn, fam.games_cap_pct, fam.games_board) == (
        True,
        "every",
        10,
        True,
    )
    assert kid.games_on is True
    assert p.status == "saved" and p.seen is False
    gp = db.get(GameProgress, (kid.id, "quickfire"))
    assert (gp.rounds, gp.best, gp.best_stars, gp.stars_total, gp.clears) == (0, 0, 0, 0, 0)


def test_game_points_row(db, kid):
    db.add(Points(user_id=kid.id, points_type=PointsType.GAME, amount=3, reason="game"))
    db.commit()


def test_bad_status_rejected(db, kid):
    db.add(_play(kid, status="bogus"))
    with pytest.raises(IntegrityError):
        db.commit()
