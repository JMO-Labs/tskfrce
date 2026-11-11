from datetime import UTC, date, datetime, timedelta

from app.models.badge import BadgeAward
from app.models.family import get_family
from app.models.game import GamePlay
from app.services import minigames_play as mp
from app.services import recap

from tests.recap_support import (  # noqa: F401  (also brings the UTC autouse fixture)
    NOW,
    W,
    _utc,  # noqa: F401
)

FIN = datetime(2026, 11, 3, 12, 0, tzinfo=UTC)


def _cat_round(db, kid, token="t", score=40):
    db.add(
        GamePlay(
            kid_id=kid.id,
            earned_day=date(2026, 11, 3),
            earned_at=datetime(2026, 11, 3, 9, 0),
            status="started",
            token=token,
            game="hungry-cat",
            level=2,
            slot=0,
            started_at=FIN.replace(tzinfo=None) - timedelta(seconds=30),
        )
    )
    db.commit()
    return mp.finish(db, get_family(db), kid, token, score, None, FIN)


def test_three_star_cat_round_awards(db, kid):
    out = _cat_round(db, kid)
    keys = {b["key"] for b in out["badges"]}
    assert keys == {"triple_star", "cat_snack_champ", "house_record"}
    held = {a.badge_key for a in db.query(BadgeAward).filter_by(kid_id=kid.id)}
    assert keys <= held


def test_family_best_is_shared(db, kid, parent):
    from app.models.user import UserRole

    from tests.conftest import _make_user

    sib = _make_user(db, "sis", UserRole.KID)
    _cat_round(db, kid, "a", 40)
    out = _cat_round(db, sib, "b", 20)
    assert "house_record" not in {b["key"] for b in out["badges"]}


def test_recap_games_fields_and_line(db, kid):
    _cat_round(db, kid)
    db.query(BadgeAward).update({"earned_at": FIN.replace(tzinfo=None)})
    db.commit()
    data = recap.week_of(db, W, NOW)
    k = data["kids"][0]
    assert k["games"] == 1 and k["game_badges"] == 3
    assert recap.games_line("Maya", 1, 2) == "Maya played 1 game and earned 2 badges"
    assert recap.games_line("Maya", 3, 1) == "Maya played 3 games and earned 1 badge"
    assert recap.games_line("Maya", 2, 0) == "Maya played 2 games"
    assert recap.games_line("Maya", 0, 0) is None
