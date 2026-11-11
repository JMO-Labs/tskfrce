from datetime import UTC, date, datetime

from app.models.chores import ChoreRun
from app.models.family import get_family
from app.models.game import GamePlay
from app.models.points import Points, PointsType
from app.services import minigames as mg

from tests.factories import make_rule, make_run

DAY = date(2026, 10, 20)


def _approve(client, db, parent, kid, ph, **kw):
    r = make_run(db, parent, kid, status="submitted", **kw)
    assert client.post(f"/api/v1/chores/{r.id}/approve", headers=ph).status_code == 200
    return r


def _plays(db, kid, status=None):
    q = db.query(GamePlay).filter(GamePlay.kid_id == kid.id)
    return q.filter(GamePlay.status == status).all() if status else q.all()


def test_approve_earns_one(client, db, parent, kid, parent_headers):
    r = _approve(client, db, parent, kid, parent_headers)
    (p,) = _plays(db, kid)
    assert (p.status, p.run_id, p.earned_day) == ("saved", r.id, DAY)


def test_sixth_with_five_saved_earns_none(client, db, parent, kid, parent_headers):
    for _ in range(6):
        _approve(client, db, parent, kid, parent_headers)
    assert len(_plays(db, kid, "saved")) == 5


def test_daily_once_per_day(client, db, parent, kid, parent_headers):
    get_family(db).games_earn = "daily"
    db.commit()
    _approve(client, db, parent, kid, parent_headers)
    _approve(client, db, parent, kid, parent_headers)
    assert len(_plays(db, kid)) == 1


def test_random_and_custom(db, parent, kid):
    fam = get_family(db)
    r = make_run(db, parent, kid, status="done")
    fam.games_earn = "random"

    class No:
        def random(self):
            return 0.7

    class Yes:
        def random(self):
            return 0.2

    assert mg.earn(db, r, fam, No()) == []
    assert mg.earn(db, r, fam, Yes()) == [kid.id]
    fam.games_earn = "custom"
    r2 = make_run(db, parent, kid, status="done")
    assert mg.earn(db, r2, fam) == []
    r2.assignment.chore.gives_game = True
    assert mg.earn(db, r2, fam) == [kid.id]


def test_switches_and_makeup(db, parent, kid):
    fam = get_family(db)
    r = make_run(db, parent, kid, status="done")
    kid.games_on = False
    assert mg.earn(db, r, fam) == []
    kid.games_on, fam.games_on = True, False
    assert mg.earn(db, r, fam) == []
    fam.games_on = True
    r.penalty_id = 4  # the Penalties feature adds this column later
    assert mg.earn(db, r, fam) == []


def test_undo_revokes_own_saved(client, db, parent, kid, parent_headers):
    r = _approve(client, db, parent, kid, parent_headers)
    assert client.post(f"/api/v1/chores/{r.id}/undo", headers=parent_headers).status_code == 200
    assert [p.status for p in _plays(db, kid)] == ["revoked"]


def test_undo_after_play_started(client, db, parent, kid, parent_headers):
    a = _approve(client, db, parent, kid, parent_headers)
    _approve(client, db, parent, kid, parent_headers)
    first = _plays(db, kid)[0]
    first.status = "started"
    db.commit()
    client.post(f"/api/v1/chores/{a.id}/undo", headers=parent_headers)
    assert sorted(p.status for p in _plays(db, kid)) == ["revoked", "started"]
    assert db.get(GamePlay, first.id).status == "started"


def test_take_back_revokes(client, db, parent, kid, parent_headers):
    kid.trust_mode, kid.trust_level = True, 1
    r = make_run(db, parent, kid, status="done", approved=False)
    r.approved_via = "trust"
    db.add(
        Points(
            user_id=kid.id,
            points_type=PointsType.TASK_COMPLETION,
            amount=3,
            reason="chore",
            run_id=r.id,
        )
    )
    mg.earn(db, r, get_family(db))
    db.commit()
    resp = client.post(f"/api/v1/chores/{r.id}/take-back", headers=parent_headers)
    assert resp.status_code == 200, resp.text
    assert [p.status for p in _plays(db, kid)] == ["revoked"]


def _pts(db, kid, run, amount):
    db.add(
        Points(
            user_id=kid.id,
            points_type=PointsType.TASK_COMPLETION,
            amount=amount,
            reason="chore",
            run_id=run.id,
        )
    )
    db.commit()


def test_cap_for(db, parent, kid):
    fam = get_family(db)
    assert mg.cap_for(db, fam, kid.id, DAY) == (1, 1)
    r = make_run(db, parent, kid, status="done")
    _pts(db, kid, r, 30)
    assert mg.cap_for(db, fam, kid.id, DAY) == (3, 3)
    db.add(
        GamePlay(
            kid_id=kid.id, earned_day=DAY, earned_at=datetime.now(UTC), status="done", points=2
        )
    )
    db.commit()
    assert mg.cap_for(db, fam, kid.id, DAY) == (1, 3)
    fam.games_cap_pct = 0
    assert mg.cap_for(db, fam, kid.id, DAY) == (0, 0)


def _utc(*a):
    return datetime(2026, 10, 20, *a, tzinfo=UTC)  # a Tuesday


def test_asleep_until_own_bedtime(db, kid):
    fam = get_family(db)
    fam.reset_time = "06:00"
    make_rule(db, kid_ids=[kid.id], times=(("07:00", "21:00"),))
    assert mg.asleep_until(db, fam, kid, _utc(22, 30)) == datetime(2026, 10, 21, 6, 0)
    assert mg.asleep_until(db, fam, kid, _utc(3, 0)) == datetime(2026, 10, 20, 6, 0)
    assert mg.asleep_until(db, fam, kid, _utc(12, 0)) is None


def test_asleep_each_kid_own_bedtime(db, kid):
    from app.models.user import UserRole

    from tests.conftest import _make_user

    sis = _make_user(db, "sis", UserRole.KID)
    fam = get_family(db)
    fam.reset_time = "06:00"
    make_rule(db, kid_ids=[kid.id], times=(("07:00", "20:00"),))
    make_rule(db, kid_ids=[sis.id], times=(("07:00", "22:00"),))
    t = _utc(21, 0)
    assert mg.asleep_until(db, fam, kid, t) == datetime(2026, 10, 21, 6, 0)
    assert mg.asleep_until(db, fam, sis, t) is None


def test_asleep_everyone_rule_and_weekday(db, kid):
    fam = get_family(db)
    fam.reset_time = "06:00"
    make_rule(db, everyone=True, days="01234", times=(("07:00", "20:30"),))
    make_rule(db, everyone=True, days="56", times=(("07:00", "22:00"),))
    assert mg.asleep_until(db, fam, kid, _utc(21, 0)) == datetime(2026, 10, 21, 6, 0)
    assert mg.asleep_until(db, fam, kid, datetime(2026, 10, 24, 21, 0, tzinfo=UTC)) is None


def test_asleep_ignores_auto_approve_time(db, kid):
    fam = get_family(db)
    fam.bedtime_auto_at, fam.reset_time = "21:00", "06:00"
    assert mg.asleep_until(db, fam, kid, _utc(23, 0)) is None


def test_quiet_hours_sleep_without_rules(db, kid):
    fam = get_family(db)
    fam.quiet_start, fam.quiet_end = "13:00", "14:00"
    assert mg.asleep_until(db, fam, kid, _utc(13, 30)) == datetime(2026, 10, 20, 14, 0)
    assert mg.asleep_until(db, fam, kid, _utc(15, 0)) is None
    fam.quiet_start, fam.quiet_end = "22:00", "07:00"
    assert mg.asleep_until(db, fam, kid, _utc(23, 0)) == datetime(2026, 10, 21, 7, 0)
    assert mg.asleep_until(db, fam, kid, _utc(3, 0)) == datetime(2026, 10, 20, 7, 0)


def test_bedtime_and_quiet_hours_both_apply(db, kid):
    fam = get_family(db)
    fam.reset_time = "06:00"
    fam.quiet_start, fam.quiet_end = "13:00", "14:00"
    make_rule(db, kid_ids=[kid.id], times=(("07:00", "21:00"),))
    assert mg.asleep_until(db, fam, kid, _utc(13, 30)) == datetime(2026, 10, 20, 14, 0)
    assert mg.asleep_until(db, fam, kid, _utc(22, 0)) == datetime(2026, 10, 21, 6, 0)
    assert mg.asleep_until(db, fam, kid, _utc(16, 0)) is None
    fam.quiet_start, fam.quiet_end = "22:00", "07:00"  # overlap: the later wake wins
    assert mg.asleep_until(db, fam, kid, _utc(23, 0)) == datetime(2026, 10, 21, 7, 0)


def test_saved_count_and_enabled(db, parent, kid):
    fam = get_family(db)
    assert mg.saved_count(db, kid.id) == 0 and mg.enabled(fam, kid)
    kid.games_on = False
    assert not mg.enabled(fam, kid)
    _ = ChoreRun
