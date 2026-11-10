import benchlib as b


def test_percentile():
    xs = list(range(1, 101))
    assert b.percentile(xs, 50) == 50
    assert b.percentile(xs, 95) == 95
    assert b.percentile([7], 95) == 7
    assert b.percentile([3, 1, 2], 100) == 3


def test_soak_growth():
    flat = [100.0] * 9
    assert b.soak_ok(flat)[0]
    grow = [100, 100, 100, 110, 115, 120, 130, 135, 140]
    ok, msg = b.soak_ok(grow)
    assert not ok and "grew" in msg
    assert b.soak_ok([10, 10, 10, 18, 18, 18])[0]  # within +10MB


def test_soak_short_series():
    assert b.soak_ok([100.0, 100.0])[0]  # too few samples: not enough to fail


def test_load_targets(tmp_path):
    f = tmp_path / "t.env"
    f.write_text("# c\nTARGET_P95_MS=300\nTARGET_BLOCK_S=3\nBACKEND_MEM=220m\n")
    assert b.load_targets(str(f)) == {"TARGET_P95_MS": 300.0, "TARGET_BLOCK_S": 3.0}


def test_gate():
    t = {"TARGET_P95_MS": 300, "TARGET_BLOCK_S": 3, "TARGET_PAINT_MS": 1000, "TARGET_RSS_MB": 600}
    good = {
        "p95_ms": {"today": 100, "kid": 90},
        "block_s_max": 1,
        "paint_ms": {"parent": 500, "kid": 400},
        "rss_mb_total": 400,
    }
    assert b.gate(good, t) == []
    bad = {
        "p95_ms": {"today": 400, "kid": 90},
        "block_s_max": 4,
        "paint_ms": {"parent": 1500, "kid": 400},
        "rss_mb_total": 700,
    }
    misses = b.gate(bad, t)
    assert len(misses) == 4
    assert any("today" in m for m in misses)
