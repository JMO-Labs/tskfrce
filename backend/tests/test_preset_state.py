"""Preset-managed settings: read, compare (edit tracking) and write."""

import json
from datetime import date

from app.models.chores import Chore, ChoreAssignment, ChoreRun
from app.models.family import get_family
from app.models.hours import HourRule
from app.models.screen_time import ScreenTimeLimit
from app.models.user import UserRole
from app.services import preset_state as ps
from app.services import presets
from app.services.chore_types import other_id

from tests.conftest import _make_user


def _kid(db, name, age="kid"):
    k = _make_user(db, name, UserRole.KID)
    k.age_group = age
    db.commit()
    return k


def _titles(db, kid):
    return ps.current(db, kid)["chores"]


def _rules(db, cat):
    return db.query(HourRule).filter(HourRule.category == cat).order_by(HourRule.id).all()


def _assign(db, parent, title, kids, mode="each", photo=False):
    c = Chore(title=title, points=10, created_by_id=parent.id, type_id=other_id(db))
    c.needs_photo = photo
    a = ChoreAssignment(repeat="daily", mode=mode, active=True)
    a.kids = list(kids)
    c.assignments = [a]
    db.add(c)
    db.commit()
    return c, a


def test_fresh_kid_gets_everything(db, parent):
    k = _kid(db, "ivy")
    res = ps.run(db, parent, {"style": "balanced"}, True)
    plan = presets.kid_plan("kid", "balanced")
    cur = ps.current(db, k)
    assert cur["chores"] == sorted(plan["chores"])
    assert (cur["screen"], cur["bedtime"], cur["weekend"]) == (120, "20:30", "22:00")
    assert (cur["lock"], cur["trust"], cur["photo"]) == (True, False, False)
    assert [r.everyone for r in _rules(db, "school_night")] == [True]
    assert [r.everyone for r in _rules(db, "weekend")] == [True]
    keys = {c["key"] for c in res["changes"]}
    assert {"chores", "screen", "bedtime"} <= keys and res["kept"] == []
    assert res["style"] == "balanced" and get_family(db).preset_style == "balanced"
    # a second identical apply changes nothing
    assert ps.run(db, parent, {"style": "balanced"}, True)["changes"] == []


def test_edited_screen_is_kept(db, parent):
    k = _kid(db, "ivy")
    db.add(ScreenTimeLimit(kid_id=k.id, max_minutes=90))
    db.commit()
    res = ps.run(db, parent, {"style": "balanced"}, True)
    assert [c["key"] for c in res["kept"]] == ["screen"]
    assert res["kept"][0] == {
        "kid_id": k.id,
        "who": k.full_name,
        "key": "screen",
        "now": 90,
        "next": 120,
    }
    assert "screen" not in {c["key"] for c in res["changes"]}
    assert db.get(ScreenTimeLimit, k.id).max_minutes == 90


def test_preview_writes_nothing(db, parent):
    k = _kid(db, "ivy")
    res = ps.run(db, parent, {"style": "strict"}, False)
    assert res["changes"] and _titles(db, k) == []
    assert get_family(db).preset_style is None and get_family(db).preset_base is None
    assert db.query(HourRule).count() == 0


def test_skip_records_base_but_does_not_write(db, parent):
    k = _kid(db, "ivy")
    res = ps.run(db, parent, {"style": "balanced", "skip": ["chores", "bedtime"]}, True)
    assert "chores" not in {c["key"] for c in res["changes"]}
    assert _titles(db, k) == [] and db.query(HourRule).count() == 0
    base = json.loads(get_family(db).preset_base)["kids"][str(k.id)]
    assert base["chores"] == sorted(presets.kid_plan("kid", "balanced")["chores"])
    assert base["bedtime"] == "20:30"


def test_family_switch_changes_banked(db, parent):
    _kid(db, "ivy")
    ps.run(db, parent, {"style": "balanced"}, True)
    assert get_family(db).screen_rollover is True
    res = ps.run(db, parent, {"style": "strict"}, True)
    assert get_family(db).screen_rollover is False
    fam = [c for c in res["changes"] if c["key"] == "banked"]
    assert fam == [{"kid_id": None, "who": None, "key": "banked", "now": True, "next": False}]


def test_kid_with_own_style_keeps_it(db, parent):
    k = _kid(db, "ivy")
    ps.run(db, parent, {"style": "balanced", "kids": {str(k.id): "strict"}}, True)
    db.refresh(k)
    assert k.preset_style == "strict" and db.get(ScreenTimeLimit, k.id).max_minutes == 60
    res = ps.run(db, parent, {"style": "relaxed"}, True)
    db.refresh(k)
    assert k.preset_style == "strict" and get_family(db).preset_style == "relaxed"
    assert db.get(ScreenTimeLimit, k.id).max_minutes == 60
    assert res["kids"][0]["style"] == "strict"


def test_listed_kid_with_family_style_follows_family(db, parent):
    k = _kid(db, "ivy")
    ps.run(db, parent, {"style": "balanced", "kids": {str(k.id): "balanced"}}, True)
    db.refresh(k)
    assert k.preset_style is None


def test_two_kids_get_own_bedtimes_and_later_switch_updates_unedited(db, parent):
    a, b = _kid(db, "ana", "little"), _kid(db, "bo", "teen")
    ps.run(db, parent, {"style": "balanced"}, True)
    assert (ps.current(db, a)["bedtime"], ps.current(db, b)["bedtime"]) == ("19:30", "21:30")
    names = sorted(r.name for r in _rules(db, "school_night"))
    assert names == ["School nights · Ana", "School nights · Bo"]
    # parent edits Bo's bedtime; a family switch updates only Ana
    next(r for r in _rules(db, "school_night") if r.kid_ids == [b.id]).times[-1].end = "23:00"
    db.commit()
    res = ps.run(db, parent, {"style": "strict"}, True)
    assert ps.current(db, a)["bedtime"] == "19:00" and ps.current(db, b)["bedtime"] == "23:00"
    assert [k["key"] for k in res["kept"] if k["kid_id"] == b.id] == ["bedtime"]


def test_everyone_rule_is_split(db, parent):
    from tests.factories import make_rule

    a, b = _kid(db, "ana"), _kid(db, "bo")
    r = make_rule(
        db, category="school_night", days="01236", times=(("06:00", "21:00"),), everyone=True
    )
    plan = presets.kid_plan("kid", "strict")
    ps.write(db, parent, a, "bedtime", plan["bedtime"], {a.id: plan})
    db.commit()
    db.refresh(r)
    assert r.everyone is False and r.kid_ids == [b.id]
    mine = next(x for x in _rules(db, "school_night") if x.kid_ids == [a.id])
    assert (mine.times[-1].start, mine.times[-1].end) == ("06:00", "20:00")
    assert ps.current(db, a)["bedtime"] == "20:00" and ps.current(db, b)["bedtime"] == "21:00"
    ps.write(db, parent, b, "bedtime", plan["bedtime"], {b.id: plan})
    db.commit()
    assert db.get(HourRule, r.id).times[-1].end == "20:00"  # now Bo's own rule


def test_chores_add_and_remove(db, parent):
    a, b = _kid(db, "ana"), _kid(db, "bo")
    # Make bed is shared with Bo; Tidy room is Ana's alone and has an open run
    _, a1 = _assign(db, parent, "Make bed", [a, b])
    _, a2 = _assign(db, parent, "Tidy room", [a])
    db.add_all(
        [
            ChoreRun(assignment_id=a1.id, day=date(2026, 10, 20), kid_id=a.id),
            ChoreRun(assignment_id=a2.id, day=date(2026, 10, 20), kid_id=a.id),
        ]
    )
    db.commit()
    ps.write(db, parent, a, "chores", ["Feed the pet"], {})
    db.commit()
    assert _titles(db, a) == ["Feed the pet"]
    assert _titles(db, b) == ["Make bed"]  # Bo keeps the shared one
    assert [k.id for k in a1.kids] == [b.id]
    assert a2.active is False and a2.kids == []
    assert {
        r.status for r in db.query(ChoreRun).filter(ChoreRun.assignment_id.in_([a1.id, a2.id]))
    } == {"cancelled"}
    assert db.query(ChoreRun).filter(ChoreRun.status == "todo").count() == 1  # Feed the pet
    ps.write(db, parent, a, "chores", ["Feed the pet", "Make bed"], {})
    db.commit()
    assert _titles(db, a) == ["Feed the pet", "Make bed"]
    assert db.query(Chore).filter(Chore.title == "Make bed").count() == 1  # reused


def test_photo_stays_on_when_another_kid_needs_it(db, parent):
    a, b = _kid(db, "ana"), _kid(db, "bo")
    c, _ = _assign(db, parent, "Make bed", [a, b], photo=True)
    assert ps.current(db, a)["photo"] is True
    ps.write(db, parent, a, "photo", False, {a.id: {"photo": False}, b.id: {"photo": True}})
    db.commit()
    assert c.needs_photo is True
    ps.write(db, parent, a, "photo", False, {a.id: {"photo": False}, b.id: {"photo": False}})
    db.commit()
    assert c.needs_photo is False
    ps.write(db, parent, a, "photo", True, {a.id: {"photo": True}})
    db.commit()
    assert c.needs_photo is True


def test_edited_rules():
    assert ps.edited("screen", 90, {"screen": 120}) is True
    assert ps.edited("screen", 120, {"screen": 120}) is False
    assert ps.edited("screen", None, {}) is False  # still the app default
    assert ps.edited("trust", True, {}) is True
    assert ps.edited("lock", True, {}) is False
