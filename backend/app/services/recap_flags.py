"""Weekly recap flag rules: pure functions over a kid's six weekly buckets (oldest first)."""

from statistics import mean

DROP, LATER_PTS, MIN_BASE, MIN_DEADLINES, MIN_STREAK, MAX_FLAGS = 0.30, 20, 5, 5, 7, 3


def _means(done: list[int], assigned: list[int]) -> float | None:
    """Mean chores done over the weeks that had chores assigned."""
    xs = [d for d, a in zip(done, assigned, strict=True) if a]
    return mean(xs) if xs else None


def _rate(pairs: list[tuple[int, int]]) -> tuple[float | None, int]:
    """Pooled on-time percent and the number of chores with a deadline."""
    total = sum(t for _, t in pairs)
    return (100 * sum(o for o, _ in pairs) / total if total else None), total


def flags(name, b, catches, streak_before, streak_now, history) -> list[dict]:
    """b = dict(done, assigned, ontime) of six weekly values, oldest first."""
    out = []
    if catches >= 2:
        out.append(("catches", f"{name} had {catches} spot-check catches this week.", "trust"))
    if history:
        recent = _means(b["done"][4:], b["assigned"][4:])
        base = _means(b["done"][:4], b["assigned"][:4])
        if recent is not None and base is not None and base >= MIN_BASE:
            if recent <= base * (1 - DROP):
                pct = round((1 - recent / base) * 100)
                out.append(
                    ("dropping", f"{name}'s chores are down {pct}% over 2 weeks.", "happy_hour")
                )
        r_pct, _ = _rate(b["ontime"][4:])
        b_pct, b_n = _rate(b["ontime"][:4])
        if r_pct is not None and b_pct is not None and b_n >= MIN_DEADLINES:
            if b_pct - r_pct >= LATER_PTS:
                out.append(("later", f"{name} is finishing chores later than usual.", "kid"))
    if streak_before >= MIN_STREAK and streak_now < streak_before:
        out.append(("streak_ended", f"{name}'s {streak_before}-day streak ended this week.", "kid"))
    return [{"kind": k, "text": t, "action": a} for k, t, a in out[:MAX_FLAGS]]
