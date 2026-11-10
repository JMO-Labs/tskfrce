"""Wheel-bonus power-ups: held per kid and game, used one per round."""

from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.models.game import GamePowerUp
from app.services import games_catalog as gc

MAX_HELD, ODDS = 2, 1 / 3


def _item(game: str, key: str) -> dict:
    name, icon = gc.POWER_UPS[game][key]
    return {"key": key, "name": name, "icon": icon}


def held(db: Session, kid_id: int, game: str) -> list[dict]:
    rows = db.query(GamePowerUp).filter_by(kid_id=kid_id, game=game).order_by(GamePowerUp.id)
    return [_item(game, r.key) for r in rows if r.key in gc.POWER_UPS.get(game, {})]


def use(db: Session, kid_id: int, game: str, key: str) -> bool:
    """Consume one held power-up. No commit; False if not held."""
    row = (
        db.query(GamePowerUp)
        .filter_by(kid_id=kid_id, game=game, key=key)
        .order_by(GamePowerUp.id)
        .first()
    )
    if row is None:
        return False
    db.delete(row)
    db.flush()
    return True


def maybe_award(db: Session, kid_id: int, game: str, rng) -> dict | None:
    """1 in 3 chance of a random power-up for `game` while holding fewer than 2. No commit."""
    keys = list(gc.POWER_UPS.get(game, ()))
    r = rng.random()
    if not keys or r >= ODDS:
        return None
    if db.query(GamePowerUp).filter_by(kid_id=kid_id).count() >= MAX_HELD:
        return None
    key = keys[int(r / ODDS * len(keys))]
    db.add(
        GamePowerUp(
            kid_id=kid_id, game=game, key=key, won_at=datetime.now(UTC).replace(tzinfo=None)
        )
    )
    db.flush()
    return _item(game, key)
