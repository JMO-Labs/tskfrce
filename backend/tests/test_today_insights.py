from datetime import UTC, date, datetime, timedelta

from app.models.family import get_family
from app.models.goal import Goal, GoalContribution
from app.models.user import UserRole

from tests.conftest import _make_user
from tests.factories import make_run

DAY = date(2026, 10, 21)  # a Wednesday
URL = "/api/v1/today/insights"


def _setup(db):
    get_family(db).last_reset_date = DAY
    db.commit()


def _run(db, parent, kid, day, hour, due="17:00", status="done"):
    sub = datetime.combine(day, datetime.min.time()) + timedelta(hours=hour)
    return make_run(db, parent, kid, day=day, status=status, due_time=due, submitted_at=sub)


def _goal(db, parent, kid, target=100, saved=0, **kw):
    g = Goal(
        name="Bike", kid_id=kid.id, target=target, status="active", created_by_id=parent.id, **kw
    )
    db.add(g)
    db.commit()
    if saved:
        db.add(
            GoalContribution(
                goal_id=g.id,
                kid_id=kid.id,
                amount=saved,
                kind="save",
                created_at=datetime.now(UTC).replace(tzinfo=None),
            )
        )
        db.commit()
    return g


def test_new_family_is_empty_not_zero(client, db, parent_headers):
    _setup(db)
    j = client.get(URL, headers=parent_headers).json()
    assert j["goals"] == []
    assert (
        j["week"]["rate"] is None
        and j["week"]["delta"] is None
        and j["week"]["has_history"] is False
    )
    assert len(j["week"]["series"]) == 14 and all(p["rate"] is None for p in j["week"]["series"])
    assert len(j["week"]["when"]) == 3 and all(row == [0] * 7 for row in j["week"]["when"])


def test_on_time_series_and_when_grid(client, db, parent, parent_headers):
    _setup(db)
    kid = _make_user(db, "leo", UserRole.KID)
    y = DAY - timedelta(days=1)  # Tuesday
    _run(db, parent, kid, y, 16)  # on time, PM
    _run(db, parent, kid, y, 18)  # late, evening
    _run(db, parent, kid, y, 8, status="skipped")  # never counted
    j = client.get(URL, headers=parent_headers).json()["week"]
    assert j["series"][-1]["day"] == DAY.isoformat()
    assert j["series"][-2] == {"day": y.isoformat(), "rate": 50, "done": 1, "total": 2}
    assert j["rate"] == 50 and j["has_history"] is True
    assert j["delta"] is None  # nothing the week before
    assert j["when"][1][1] == 1 and j["when"][2][1] == 1  # Tue PM, Tue evening
    assert j["goal"] == 75


def test_past_submitted_on_time_counts_as_on_time(client, db, parent, parent_headers):
    _setup(db)
    kid = _make_user(db, "leo", UserRole.KID)
    y = DAY - timedelta(days=1)
    _run(db, parent, kid, y, 16, status="submitted")  # handed in on time, not yet approved
    j = client.get(URL, headers=parent_headers).json()["week"]
    assert j["series"][-2] == {"day": y.isoformat(), "rate": 100, "done": 1, "total": 1}


def test_delta_vs_previous_week(client, db, parent, parent_headers):
    _setup(db)
    kid = _make_user(db, "leo", UserRole.KID)
    _run(db, parent, kid, DAY - timedelta(days=1), 16)
    _run(db, parent, kid, DAY - timedelta(days=9), 16)
    _run(db, parent, kid, DAY - timedelta(days=9), 20)
    j = client.get(URL, headers=parent_headers).json()["week"]
    assert (j["rate"], j["delta"]) == (100, 50)


def test_goals_closest_first_with_eta(client, db, parent, parent_headers):
    _setup(db)
    a = _make_user(db, "leo", UserRole.KID)
    b = _make_user(db, "maya", UserRole.KID)
    _goal(db, parent, a, target=100, saved=34)
    _goal(db, parent, b, target=100, saved=70)
    gs = client.get(URL, headers=parent_headers).json()["goals"]
    assert [g["pct"] for g in gs] == [70, 34]
    assert gs[0]["kid_id"] == b.id
    # 70 earned in the last 7 days = 10/day; 30 left -> 3 days
    assert gs[0]["eta_days"] == 3
    assert gs[1]["eta_days"] == 14  # 34 in 7 days, 66 left


def test_goal_without_recent_earning_has_no_eta(client, db, parent, parent_headers):
    _setup(db)
    a = _make_user(db, "leo", UserRole.KID)
    _goal(db, parent, a, target=100)
    g = client.get(URL, headers=parent_headers).json()["goals"][0]
    assert g["pct"] == 0 and g["eta_days"] is None
