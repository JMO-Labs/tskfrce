"""Minigame catalog, scoring and wheel pick. Pure: no database."""

import random
from dataclasses import dataclass


@dataclass(frozen=True)
class GameDef:
    key: str
    name: str
    kind: str  # "quick" | "think"
    icon: str
    ages: tuple[str, ...]
    max_score: int
    min_secs: int
    max_rate: float
    stars_at: tuple[int, int, int]


ALL_AGES = ("little", "kid", "teen")
GAMES: dict[str, GameDef] = {
    g.key: g
    for g in (
        GameDef(
            "quickfire", "Quick-fire", "quick", "⚡", ALL_AGES, 45 * 150, 3, 150, (500, 1100, 1800)
        ),
        GameDef("hungry-cat", "Hungry Cat", "think", "🐱", ALL_AGES, 300, 3, 4, (10, 25, 40)),
    )
}
MICRO = (
    "sock-snatch plate-tower bubble-pop quick-draw sweep-swipe flip plug zip squeeze dodge "
    "water hang shh catch match fold feed spot count cat-dash"
).split()
TICKETS = (1, 3, 6, 10)
BADGE_KEYS = ("arcade_ace", "triple_star", "try_it_all", "house_record", "cat_snack_champ")
START_LEVEL = {"little": 1, "kid": 2, "teen": 3}
MAX_PARTS, MAX_MISSES = 45, 3
PART_MS = (150, 6000)


def part_score(ms: int) -> int:
    return 100 + max(0, 50 - ms // 60)


def quick_score(parts: list[dict]) -> int:
    return sum(part_score(p["ms"]) for p in parts if p["ok"])


def stars_for(game: str, score: int) -> int:
    return sum(score >= t for t in GAMES[game].stars_at)


def check_quick(parts: list[dict] | None, elapsed_s: float) -> bool:
    if not parts or len(parts) > MAX_PARTS:
        return False
    if any(p["game"] not in MICRO or not PART_MS[0] <= p["ms"] <= PART_MS[1] for p in parts):
        return False
    if sum(not p["ok"] for p in parts) > MAX_MISSES:
        return False
    return sum(p["ms"] for p in parts) <= elapsed_s * 1000 + 2000


def check_score(game: str, score: int, elapsed_s: float) -> bool:
    g = GAMES[game]
    return (
        0 <= score <= g.max_score
        and elapsed_s >= g.min_secs
        and score <= g.max_rate * elapsed_s + 1
    )


def eligible_think(age: str) -> list[str]:
    return [k for k, g in GAMES.items() if g.kind == "think" and age in g.ages]


def wheel_slots(think: list[str], game: str) -> list[str]:
    """Six wheel slots: quick-fire and thinking games alternate; `game` is always on it."""
    slots = [("quickfire", think[i // 2 % len(think)])[i % 2] for i in range(6)]
    if game not in slots:  # a thinking game the cycle didn't reach
        slots[1] = game
    return slots


def pick(age: str, rng: random.Random) -> tuple[str, list[str], int]:
    """(game, 6 wheel slots, index of the slot the wheel lands on)."""
    think = eligible_think(age)
    game = "quickfire" if rng.random() < 0.5 else rng.choice(think)
    slots = wheel_slots(think, game)
    return game, slots, rng.choice([i for i, s in enumerate(slots) if s == game])
