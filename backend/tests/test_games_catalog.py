import random

from app.services import games_catalog as gc


def test_part_and_quick_score():
    assert gc.part_score(0) == 150
    assert gc.part_score(3000) == 100
    assert gc.quick_score([{"ok": True, "ms": 600}, {"ok": False, "ms": 900}]) == 140


def test_stars():
    assert gc.stars_for("hungry-cat", 24) == 1
    assert gc.stars_for("hungry-cat", 40) == 3
    assert gc.stars_for("quickfire", 0) == 0


def _parts(n, ms=600, key="sock-snatch"):
    return [{"game": key, "ok": True, "ms": ms} for _ in range(n)]


def test_check_quick():
    assert gc.check_quick(_parts(10), 30.0)
    assert not gc.check_quick(_parts(46), 120.0)
    assert not gc.check_quick(_parts(3, ms=100), 30.0)
    assert not gc.check_quick(_parts(3, ms=6001), 60.0)
    assert not gc.check_quick(_parts(3, key="nope"), 30.0)
    miss = [{"game": "flip", "ok": False, "ms": 600}] * 4
    assert not gc.check_quick(miss, 30.0)
    assert not gc.check_quick(_parts(10), 3.0)  # 6000 ms > 3000 + 2000


def test_check_score():
    assert not gc.check_score("hungry-cat", 50, 5.0)
    assert gc.check_score("hungry-cat", 20, 30.0)
    assert not gc.check_score("hungry-cat", 5, 2.0)
    assert not gc.check_score("hungry-cat", -1, 30.0)
    assert not gc.check_score("hungry-cat", 301, 300.0)


def test_pick():
    game, slots, slot = gc.pick("kid", random.Random(1))
    assert len(slots) == 6 and slots[slot] == game
    assert gc.MICRO[0] == "sock-snatch" and len(gc.MICRO) == 20
    q = sum(gc.pick("kid", random.Random(s))[0] == "quickfire" for s in range(1000)) / 1000
    assert 0.4 <= q <= 0.6
