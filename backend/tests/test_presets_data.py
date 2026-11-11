import re
from pathlib import Path

import pytest
from app.services import presets
from app.services.presets import AGES, STARTERS, STYLES, catalog, family_plan, kid_plan


def test_kid_age_base_values():
    assert kid_plan("kid", "relaxed") == {
        "chores": ["Make bed", "Feed the pet"],
        "screen": 180,
        "bedtime": "21:00",
        "weekend": "22:30",
        "lock": False,
        "trust": True,
        "photo": False,
    }
    s = kid_plan("kid", "strict")
    assert (len(s["chores"]), s["screen"], s["bedtime"], s["weekend"]) == (4, 60, "20:00", "21:30")
    assert (s["lock"], s["trust"], s["photo"]) == (True, False, True)


def test_mockup_values():
    t = kid_plan("teen", "relaxed")
    assert t["chores"] == ["Unload dishwasher", "Take out trash"]
    assert (t["screen"], t["bedtime"]) == (210, "22:00")
    b = kid_plan("kid", "balanced")
    assert b["chores"] == ["Make bed", "Feed the pet", "Tidy room"]
    assert (b["screen"], b["bedtime"], b["weekend"]) == (120, "20:30", "22:00")


def test_little_strict_clamps():
    p = kid_plan("little", "strict")
    assert p["screen"] == 30
    assert len(p["chores"]) == 3
    assert kid_plan("little", "relaxed")["chores"] == ["Make bed"]


def test_picks_in_starters():
    for pick in presets.PICKS.values():
        for title in pick:
            assert title in STARTERS


def test_family_and_catalog():
    assert family_plan("strict") == {"banked": False, "goals": True, "penalties": True}
    assert family_plan("balanced") == {"banked": True, "goals": True, "penalties": False}
    c = catalog()
    assert set(c["plans"]) == set(AGES)
    assert set(c["plans"]["kid"]) == set(STYLES)
    assert c["family"]["relaxed"] == {"banked": True, "goals": True, "penalties": False}


def test_starters_match_frontend():
    ts = Path(__file__).resolve().parents[2] / "frontend/src/v2/setup/starterChores.ts"
    if not ts.exists():
        pytest.skip("frontend file missing")
    rows = re.findall(r"\{ title: '([^']+)', type: '([^']+)'.*?points: (\d+)", ts.read_text())
    assert rows
    for title, typ, pts in rows:
        assert STARTERS[title][:2] == (typ, int(pts))
    assert len(rows) == len(STARTERS)
