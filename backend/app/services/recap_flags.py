"""Weekly recap flag rules: pure functions over a kid's six weekly buckets (oldest first)."""

import unicodedata
from fractions import Fraction

DROP, LATER_PTS, MIN_BASE, MIN_DEADLINES, MAX_FLAGS = Fraction(3, 10), 20, 5, 5, 3
MIN_STREAK, NAME_MAX = 7, 40


def _means(done: list[int], assigned: list[int]) -> Fraction | None:
    """Mean chores done over the weeks that had chores assigned."""
    xs = [d for d, a in zip(done, assigned, strict=True) if a]
    return Fraction(sum(xs), len(xs)) if xs else None


def _rate(pairs: list[tuple[int, int]]) -> tuple[Fraction | None, int]:
    """Pooled on-time percent and the number of chores with a deadline."""
    total = sum(t for _, t in pairs)
    return (Fraction(100 * sum(o for o, _ in pairs), total) if total else None), total


def clean(name: str) -> str:
    """A name safe for message text: no control characters or line breaks, at most 40 chars."""
    s = "".join(" " if unicodedata.category(c)[0] == "C" else c for c in name)
    return " ".join(s.split())[:NAME_MAX]


def flags(name, b, catches, ended, history) -> list[dict]:
    """b = dict(done, assigned, ontime) of six weekly values, oldest first.
    ended = length of a streak (7+) that ended this week, else 0."""
    name = clean(name)
    out = []
    if catches >= 2:
        out.append(
            (
                "catches",
                f"{name} had {catches} spot-check catches this week.",
                "trust",
                {"count": catches},
            )
        )
    if history:
        recent = _means(b["done"][4:], b["assigned"][4:])
        base = _means(b["done"][:4], b["assigned"][:4])
        if recent is not None and base is not None and base >= MIN_BASE:
            if recent <= base * (1 - DROP):
                pct = round((1 - recent / base) * 100)
                text = f"{name}'s chores are down {pct}% over 2 weeks."
                out.append(
                    ("dropping", text, "happy_hour", {"now": round(recent), "was": round(base)})
                )
        r_pct, _ = _rate(b["ontime"][4:])
        b_pct, b_n = _rate(b["ontime"][:4])
        if r_pct is not None and b_pct is not None and b_n >= MIN_DEADLINES:
            if b_pct - r_pct >= LATER_PTS:
                text = f"{name} is finishing chores later than usual."
                out.append(("later", text, "kid", {"now": round(r_pct), "was": round(b_pct)}))
    if ended:
        text = f"{name}'s {ended}-day streak ended this week."
        out.append(("streak_ended", text, "kid", {"count": ended}))
    return [{"kind": k, "text": t, "action": a, **x} for k, t, a, x in out[:MAX_FLAGS]]
