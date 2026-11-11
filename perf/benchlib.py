"""Pure bench math: percentile, soak growth check, target comparison."""

import math


def percentile(xs, p):
    """Nearest-rank percentile."""
    s = sorted(xs)
    return s[max(0, math.ceil(p / 100 * len(s)) - 1)]


def soak_ok(rss, pct=0.10, mb=10.0):
    """Fail if mean of last third > mean of first third * (1+pct) + mb."""
    n = len(rss) // 3
    if n < 1:
        return True, "too few samples"
    first, last = sum(rss[:n]) / n, sum(rss[-n:]) / n
    if last > first * (1 + pct) + mb:
        return False, f"RSS grew {first:.0f}MB -> {last:.0f}MB"
    return True, f"RSS {first:.0f}MB -> {last:.0f}MB"


def load_targets(path):
    out = {}
    for line in open(path):
        k, _, v = line.strip().partition("=")
        if k.startswith("TARGET_"):
            out[k] = float(v)
    return out


def gate(res, t):
    """List of target misses (empty = pass)."""
    m = []
    for name, v in res["p95_ms"].items():
        if v > t["TARGET_P95_MS"]:
            m.append(f"p95 {name} {v:.0f}ms > {t['TARGET_P95_MS']:.0f}ms")
    if res["block_s_max"] > t["TARGET_BLOCK_S"]:
        m.append(f"block latency {res['block_s_max']:.2f}s > {t['TARGET_BLOCK_S']:.0f}s")
    for name, v in res["paint_ms"].items():
        if v > t["TARGET_PAINT_MS"]:
            m.append(f"paint {name} {v:.0f}ms > {t['TARGET_PAINT_MS']:.0f}ms")
    if res["rss_mb_total"] > t["TARGET_RSS_MB"]:
        m.append(f"RSS {res['rss_mb_total']:.0f}MB > {t['TARGET_RSS_MB']:.0f}MB")
    return m
