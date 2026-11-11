"""Starting and finishing minigame rounds, the shelf and the family board.
The server picks the game and is the only authority on score, stars and points."""

import random
import secrets
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.game import GamePlay, GameProgress
from app.models.points import Points, PointsType
from app.models.user import User, UserRole
from app.schemas.lock import utc_z
from app.services import badges, economy, minigames
from app.services import chores as svc
from app.services import games_catalog as gc
from app.services import minigames_power as power


def _have(db: Session, kid_id: int, game: str) -> int:
    p = db.get(GameProgress, (kid_id, game))
    if p is None:
        return 0
    return p.clears if game.startswith("qf:") else p.stars_total


def started_out(db: Session, play: GamePlay, age: str = "kid") -> dict:
    out = {
        "play_id": play.id,
        "token": play.token,
        "game": play.game,
        "kind": gc.GAMES[play.game].kind,
        "level": play.level,
        "slots": gc.wheel_slots(gc.eligible_think(age), play.game),
        "slot": play.slot,
        "upgrades": gc.upgrades_for(play.game, _have(db, play.kid_id, play.game)),
        "power_ups": power.held(db, play.kid_id, play.game),
    }
    if play.game == "quickfire":
        micro = {m: gc.upgrades_for(f"qf:{m}", _have(db, play.kid_id, f"qf:{m}")) for m in gc.MICRO}
        out["micro_upgrades"] = {m: u for m, u in micro.items() if u}
    return out


def _clock(fam, end_utc: datetime) -> str:
    t = end_utc.replace(tzinfo=UTC).astimezone(ZoneInfo(fam.timezone))
    return f"{t.hour % 12 or 12}:{t.minute:02d} {'AM' if t.hour < 12 else 'PM'}"


def _started(db: Session, kid_id: int) -> GamePlay | None:
    return db.query(GamePlay).filter_by(kid_id=kid_id, status="started").first()


def start(db: Session, fam, kid: User, now_utc: datetime, rng=random) -> dict:
    """Begin the oldest saved play (or resume the started one). Commits."""
    if not minigames.enabled(fam, kid):
        raise HTTPException(403, "Games are off.")
    cur = _started(db, kid.id)
    if cur:
        return started_out(db, cur, kid.age_group)
    wake = minigames.asleep_until(db, fam, kid, now_utc)
    if wake:
        raise HTTPException(409, f"Games are asleep until {_clock(fam, wake)}.")
    game, _, slot = gc.pick(kid.age_group, rng)
    for play in db.query(GamePlay).filter_by(kid_id=kid.id, status="saved").order_by(GamePlay.id):
        won = (  # compare-and-set, so two taps cannot start the same play
            db.query(GamePlay)
            .filter(GamePlay.id == play.id, GamePlay.status == "saved")
            .update(
                {
                    "status": "started",
                    "token": secrets.token_urlsafe(32),
                    "game": game,
                    "slot": slot,
                    "level": gc.START_LEVEL[kid.age_group],
                    "started_at": now_utc.replace(tzinfo=None),
                    "seen": True,
                },
                synchronize_session=False,
            )
        )
        if won:
            db.commit()
            db.refresh(play)
            return started_out(db, play, kid.age_group)
    raise HTTPException(409, "No saved games. Finish a chore to earn one.")


def _progress(db: Session, kid_id: int, game: str) -> GameProgress:
    p = db.get(GameProgress, (kid_id, game))
    if p is None:
        p = GameProgress(
            kid_id=kid_id, game=game, rounds=0, best=0, best_stars=0, stars_total=0, clears=0
        )
        db.add(p)
    return p


def finish(
    db: Session,
    fam,
    kid: User,
    token: str,
    score: int,
    parts: list[dict] | None,
    now_utc: datetime,
    power_up: str | None = None,
    rng=random,
) -> dict:
    """Close a started play once, pay it, record progress. Commits."""
    now = now_utc.replace(tzinfo=None)
    if power_up:  # reject before the play is closed, so a bad request keeps it
        cur = db.query(GamePlay).filter_by(token=token, kid_id=kid.id, status="started").first()
        if cur and power_up not in {h["key"] for h in power.held(db, kid.id, cur.game)}:
            raise HTTPException(422, "You don't have that power-up.")
    won = (  # compare-and-set: a replay or a racing tab gets 404
        db.query(GamePlay)
        .filter(GamePlay.token == token, GamePlay.kid_id == kid.id, GamePlay.status == "started")
        .update({"status": "done", "finished_at": now}, synchronize_session=False)
    )
    if won != 1:
        db.rollback()
        raise HTTPException(404, "That game already ended.")
    play = db.query(GamePlay).filter_by(token=token).one()
    db.refresh(play)
    elapsed = (now - play.started_at).total_seconds()
    quick = play.game == "quickfire"
    if quick:
        ok = gc.check_quick(parts, elapsed)
        score = gc.quick_score(parts) if ok else 0
    else:
        ok = gc.check_score(play.game, score, elapsed)
    if not ok:
        play.score = play.stars = play.tickets = play.points = 0
        db.commit()
        raise HTTPException(422, "That score isn't possible.")
    stars = gc.stars_for(play.game, score)
    tickets = gc.TICKETS[stars]
    left = minigames.cap_for(db, fam, kid.id, play.earned_day)[0]
    points = min(tickets, left)
    play.score, play.stars, play.tickets, play.points = score, stars, tickets, points
    before = economy.level_of(db, kid.id)
    if points > 0:
        db.add(
            Points(
                user_id=kid.id,
                points_type=PointsType.GAME,
                amount=points,
                reason="game",
                description=f"Game: {gc.GAMES[play.game].name}",
            )
        )
    if power_up and not power.use(db, kid.id, play.game, power_up):
        db.rollback()
        raise HTTPException(422, "You don't have that power-up.")
    prog = _progress(db, kid.id, play.game)
    db.flush()
    had = prog.stars_total
    new_best = score > prog.best
    prog.rounds += 1
    prog.best = max(prog.best, score)
    prog.best_stars = max(prog.best_stars, stars)
    prog.stars_total += stars
    if quick:
        for part in parts:
            micro = _progress(db, kid.id, f"qf:{part['game']}")
            micro.rounds += 1
            micro.clears += bool(part["ok"])
            db.flush()  # autoflush is off: make this row visible to the next part
    db.flush()
    unlocked = gc.upgrades_for(play.game, prog.stars_total)[len(gc.upgrades_for(play.game, had)) :]
    bonus = power.maybe_award(db, kid.id, play.game, rng)
    economy.level_check(db, kid.id, before)
    won_badges = [a for a in badges.check_badges(db, kid, fam) if a.badge_key in gc.BADGE_KEYS]
    out = {
        "stars": stars,
        "tickets": tickets,
        "points": points,
        "capped": points < tickets,
        "score": score,
        "best": prog.best,
        "new_best": new_best,
        "badges": [
            {
                "key": a.badge_key,
                "name": badges.CATALOG[a.badge_key].name,
                "icon": badges.CATALOG[a.badge_key].icon,
                "tier": a.tier,
            }
            for a in won_badges
        ],
        "saved": minigames.saved_count(db, kid.id),
        "upgrade": gc.next_upgrade(play.game, prog.stars_total),
        "unlocked": gc.UPGRADE_NAMES[unlocked[-1]] if unlocked else None,
        "bonus": bonus,
    }
    db.commit()
    return out


def _week_start(fam, now_utc: datetime) -> datetime:
    """Monday 00:00 in the family time zone, as naive UTC."""
    local = now_utc.astimezone(ZoneInfo(fam.timezone))
    mon = (local - timedelta(days=local.weekday())).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    return mon.astimezone(UTC).replace(tzinfo=None)


def _board(db: Session, fam, kid: User, since: datetime) -> dict | None:
    if not fam.games_board:
        return None
    kids = (
        db.query(User)
        .filter(User.role == UserRole.KID, User.age_group == kid.age_group, User.games_on.is_(True))
        .all()
    )
    stars = dict(
        db.query(GamePlay.kid_id, func.coalesce(func.sum(GamePlay.stars), 0))
        .filter(GamePlay.status == "done", GamePlay.finished_at >= since)
        .group_by(GamePlay.kid_id)
        .all()
    )
    rows = [
        {
            "kid_id": k.id,
            "name": k.full_name,
            "avatar": k.avatar,
            "stars": int(stars.get(k.id, 0)),
            "me": k.id == kid.id,
        }
        for k in kids
    ]
    rows.sort(key=lambda r: (-r["stars"], not r["me"], r["name"] or ""))
    return {"band": kid.age_group, "rows": rows}


def shelf(db: Session, fam, kid: User, now_utc: datetime) -> dict:
    """Body of GET /kid/games."""
    since = _week_start(fam, now_utc)
    saved = db.query(GamePlay).filter_by(kid_id=kid.id, status="saved").all()
    cur = _started(db, kid.id)
    wake = minigames.asleep_until(db, fam, kid, now_utc)
    prog = {p.game: p for p in db.query(GameProgress).filter_by(kid_id=kid.id)}
    left, top = minigames.cap_for(db, fam, kid.id, svc.today(db, now_utc))
    return {
        "on": minigames.enabled(fam, kid),
        "saved": len(saved),
        "fresh": sum(not p.seen for p in saved),
        "started": started_out(db, cur, kid.age_group) if cur else None,
        "asleep_until": utc_z(wake) if wake else None,
        "games": [
            {
                "key": g.key,
                "name": g.name,
                "kind": g.kind,
                "icon": g.icon,
                "stars": prog[g.key].best_stars if g.key in prog else 0,
                "rounds": prog[g.key].rounds if g.key in prog else 0,
                "best": prog[g.key].best if g.key in prog else 0,
                "upgrades": len(gc.upgrades_for(g.key, prog[g.key].stars_total))
                if g.key in prog
                else 0,
            }
            for g in gc.GAMES.values()
        ],
        "board": _board(db, fam, kid, since),
        "family_rounds": db.query(GamePlay)
        .filter(GamePlay.status == "done", GamePlay.finished_at >= since)
        .count(),
        "cap": {"left": left, "max": top},
    }
