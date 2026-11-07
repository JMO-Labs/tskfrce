"""Streak freezes: derived from the chore days, earned every 7-day run, held up to 2."""

from datetime import UTC, date, datetime, timedelta

from app.lock.reset import current_chore_day
from app.models.family import get_family
from app.services import badges as bd
from app.services import progression as pr

from tests.conftest import _headers
from tests.factories import make_run

T = date(2026, 10, 30)


def _days(pattern: str, end: date = T) -> dict[date, bool]:
    """'1' done, '0' missed, '.' nothing assigned; the last char is `end`."""
    start = end - timedelta(days=len(pattern) - 1)
    return {start + timedelta(days=i): c == "1" for i, c in enumerate(pattern) if c != "."}


def test_review_focus_5_seven_then_two_missed_then_done_breaks():
    """One freeze earned at 7, the first miss uses it, the second miss breaks."""
    s = pr.streak_with_freezes(_days("1111111" + "00" + "1"), T)
    assert (s.current, s.longest, s.runs) == (1, 7, [7])
    assert s.frozen == [] and s.freezes_held == 0  # frozen covers only the current run


def test_one_missed_day_is_frozen_and_the_streak_continues():
    s = pr.streak_with_freezes(_days("1111111" + "0" + "1"), T)
    assert (s.current, s.runs) == (8, []) and s.frozen == [T - timedelta(days=1)]
    assert s.freezes_held == 0


def test_freezes_cap_at_two():
    s = pr.streak_with_freezes(_days("1" * 21), T)
    assert s.current == 21 and s.freezes_held == 2 and s.frozen == []
    s = pr.streak_with_freezes(_days("1" * 21 + "000" + "1"), T)
    assert s.frozen == [] and s.freezes_held == 0 and s.runs == [21] and s.current == 1
    s = pr.streak_with_freezes(_days("1" * 21 + "00" + "1"), T)
    assert s.frozen == [T - timedelta(days=2), T - timedelta(days=1)]
    assert s.freezes_held == 0 and s.current == 22 and s.runs == []


def test_earned_again_after_use():
    s = pr.streak_with_freezes(_days("1" * 7 + "0" + "1" * 7), T)
    assert s.current == 14 and s.freezes_held == 1 and len(s.frozen) == 1


def test_no_freeze_before_seven():
    s = pr.streak_with_freezes(_days("111111" + "0" + "1"), T)
    assert s.current == 1 and s.frozen == [] and s.runs == [6]


def test_today_never_breaks_or_uses_a_freeze():
    s = pr.streak_with_freezes(_days("1" * 7 + "0"), T)
    assert s.current == 7 and s.freezes_held == 1 and s.frozen == []


def test_days_without_chores_are_skipped():
    s = pr.streak_with_freezes(_days("1111" + ".." + "111"), T)
    assert s.current == 7 and s.freezes_held == 1


def test_off_is_identical_to_streak_of():
    for pat in ("1111111001", "1" * 21 + "0001", "10101", "", "1111110", "0"):
        days = _days(pat)
        assert pr.streak_for(days, T, freeze=False) == pr.streak_of(days, T)
    on = pr.streak_for(_days("11111110" + "1"), T, freeze=True)
    assert on.current == 8


# --- wired into progress and community profiles ---

D, TODO = "done", "todo"


def _seed(db, parent, kid, today, pattern):
    """Same pattern language, ending at `today`."""
    for d, ok in _days(pattern, today).items():
        make_run(db, parent, kid, day=d, status=D if ok else TODO, title=str(d))


def _today(db):
    fam = get_family(db)
    t = current_chore_day(fam, datetime.now(UTC))
    fam.last_reset_date = t
    db.commit()
    return t


def test_review_focus_5_progress_and_profiles_agree(client, db, parent, kid, parent_headers):
    t = _today(db)
    _seed(db, parent, kid, t, "1111111" + "00" + "1")
    kid_p = client.get("/api/v1/kid/today", headers=_headers(db, kid)).json()["progress"]
    assert kid_p["streak"] == 1 and kid_p["freezes_held"] == 0
    assert kid_p["frozen"] == []
    par = client.get("/api/v1/today", headers=parent_headers).json()["kids"][0]["progress"]
    assert par == kid_p
    [prof] = client.get("/api/v1/profiles", headers=parent_headers).json()
    assert (prof["streak"], prof["freezes_held"], prof["frozen"]) == (1, 0, kid_p["frozen"])


def test_one_miss_frozen_in_progress_and_profiles(client, db, parent, kid, parent_headers):
    t = _today(db)
    _seed(db, parent, kid, t, "1111111" + "0" + "1")
    kid_p = client.get("/api/v1/kid/today", headers=_headers(db, kid)).json()["progress"]
    assert kid_p["streak"] == 8 and kid_p["frozen"] == [(t - timedelta(days=1)).isoformat()]
    [prof] = client.get("/api/v1/profiles", headers=parent_headers).json()
    assert prof["streak"] == 8


def test_setting_off_uses_plain_streak(client, db, parent, kid, parent_headers):
    t = _today(db)
    _seed(db, parent, kid, t, "1111111" + "0" + "1")
    r = client.patch("/api/v1/family", json={"streak_freeze": False}, headers=parent_headers)
    assert r.status_code == 200 and r.json()["streak_freeze"] is False
    kid_p = client.get("/api/v1/kid/today", headers=_headers(db, kid)).json()["progress"]
    assert (kid_p["streak"], kid_p["freezes_held"], kid_p["frozen"]) == (1, None, [])
    [prof] = client.get("/api/v1/profiles", headers=parent_headers).json()
    assert prof["streak"] == 1 and prof["freezes_held"] is None  # off: hide the freezes line


def test_streak_freeze_on_by_default(client, parent_headers):
    assert client.get("/api/v1/family", headers=parent_headers).json()["streak_freeze"] is True


# --- badges follow the shown (freeze-aware) streak ---


def test_on_fire_tier_uses_freeze_aware_longest(db, parent, kid):
    t = _today(db)
    _seed(db, parent, kid, t, "1" * 7 + "0" + "1" * 23)  # 30 with the freeze, 23 without
    got = {a.badge_key: a.tier for a in bd.check_badges(db, kid, get_family(db))}
    assert got["on_fire"] == 2


def test_on_fire_plain_when_freeze_off(db, parent, kid):
    t = _today(db)
    get_family(db).streak_freeze = False
    _seed(db, parent, kid, t, "1" * 7 + "0" + "1" * 23)
    got = {a.badge_key: a.tier for a in bd.check_badges(db, kid, get_family(db))}
    assert got["on_fire"] == 1
