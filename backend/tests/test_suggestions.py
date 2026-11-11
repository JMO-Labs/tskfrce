from datetime import date, datetime, timedelta

from app.models.chores import ChoreRun
from app.models.goal import Goal, GoalContribution
from app.models.homework import HomeworkRequest
from app.models.lock import Device
from app.models.user import UserRole

from tests.conftest import _make_user
from tests.factories import make_chore

U = "/api/v1/suggestions"
TODAY = date.today()


def _d(n):
    return TODAY - timedelta(days=n)


def _runs(db, a, kid, statuses, start=1):
    for i, s in enumerate(statuses):
        db.add(ChoreRun(assignment_id=a.id, day=_d(start + i), kid_id=kid.id, status=s))
    db.commit()


def _get(client, h):
    r = client.get(U, headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def _keys(client, h):
    return [i["key"] for i in _get(client, h)["items"]]


def _old(db, *users, days=30):
    for u in users:
        u.created_at = datetime.utcnow() - timedelta(days=days)
    db.commit()


def _quiet(db, parent, kid):
    """Age the accounts and add a second parent + a goal so only the rule under test fires."""
    p2 = _make_user(db, "dad", UserRole.PARENT)
    _old(db, parent, kid, p2)
    db.add(Goal(name="Bike", kid_id=kid.id, target=1000, status="active", created_by_id=parent.id))
    db.commit()
    g = db.query(Goal).first()
    db.add(GoalContribution(goal_id=g.id, kid_id=kid.id, amount=1, kind="save"))
    db.commit()


def test_requires_parent(client, kid_headers):
    assert client.get(U, headers=kid_headers).status_code == 403


def test_empty_family(client, parent_headers):
    assert _get(client, parent_headers) == {"hidden": False, "items": []}


def test_chore_skipped_names_subject_and_reappears_on_new_fingerprint(
    db, client, parent, kid, parent_headers
):
    _quiet(db, parent, kid)
    _, a = make_chore(db, parent, "Dishes", kids=[kid])
    _runs(db, a, kid, ["skipped", "missed", "skipped"], start=1)
    items = _get(client, parent_headers)["items"]
    s = next(i for i in items if i["rule"] == "chore.skipped")
    assert "Dishes" in s["body"] and "Timmy" in s["body"]
    assert s["title"] and s["action"]["kind"] and s["fingerprint"]
    r = client.post(
        U + "/dismiss",
        json={"key": s["key"], "fingerprint": s["fingerprint"]},
        headers=parent_headers,
    )
    assert r.status_code == 200
    assert s["key"] not in _keys(client, parent_headers)
    # same facts: still quiet; a new skipped day: back
    db.add(ChoreRun(assignment_id=a.id, day=TODAY, kid_id=kid.id, status="skipped"))
    db.commit()
    assert s["key"] in _keys(client, parent_headers)


def test_chore_skipped_needs_three_in_a_row(db, client, parent, kid, parent_headers):
    _quiet(db, parent, kid)
    _, a = make_chore(db, parent, "Dishes", kids=[kid])
    _runs(db, a, kid, ["skipped", "done", "skipped", "skipped"])
    assert not any(k.startswith("chore.skipped") for k in _keys(client, parent_headers))


def test_chore_stale(db, client, parent, kid, parent_headers):
    _quiet(db, parent, kid)
    c, a = make_chore(db, parent, "Vacuum", kids=[kid])
    a.created_at = datetime.utcnow() - timedelta(days=10)
    db.commit()
    s = next(i for i in _get(client, parent_headers)["items"] if i["rule"] == "chore.stale")
    assert "Vacuum" in s["body"]
    _runs(db, a, kid, ["done"], start=2)
    assert not any(k.startswith("chore.stale") for k in _keys(client, parent_headers))


def test_kid_cruising(db, client, parent, kid, parent_headers):
    _quiet(db, parent, kid)
    _, a = make_chore(db, parent, "Dishes", kids=[kid])
    _runs(db, a, kid, ["done"] * 5)
    s = next(i for i in _get(client, parent_headers)["items"] if i["rule"] == "kid.cruising")
    assert "Timmy" in s["body"]


def test_goal_close(db, client, parent, kid, parent_headers):
    _quiet(db, parent, kid)
    g = Goal(name="Lego", kid_id=kid.id, target=100, status="active", created_by_id=parent.id)
    db.add(g)
    db.commit()
    db.add(
        GoalContribution(
            goal_id=g.id,
            kid_id=kid.id,
            amount=70,
            kind="save",
            created_at=datetime.utcnow() - timedelta(days=1),
        )
    )
    db.commit()  # 70 in 7 days = 10/day, 30 left = 3 days
    s = next(i for i in _get(client, parent_headers)["items"] if i["rule"] == "goal.close")
    assert "Lego" in s["body"] and "Timmy" in s["body"]


def test_goal_missing_none(db, client, parent, kid, parent_headers):
    _old(db, parent, kid)
    _make_user(db, "dad", UserRole.PARENT)
    s = next(i for i in _get(client, parent_headers)["items"] if i["rule"] == "goal.missing")
    assert "Timmy" in s["body"]


def test_goal_missing_stalled(db, client, parent, kid, parent_headers):
    _old(db, parent, kid)
    g = Goal(
        name="Bike",
        kid_id=kid.id,
        target=500,
        status="active",
        created_by_id=parent.id,
        created_at=datetime.utcnow() - timedelta(days=20),
    )
    db.add(g)
    db.commit()
    s = next(i for i in _get(client, parent_headers)["items"] if i["rule"] == "goal.missing")
    assert "Bike" in s["body"]


def test_family_parent(db, client, parent, kid, parent_headers):
    _old(db, parent)
    assert "family.parent" in _keys(client, parent_headers)
    _make_user(db, "dad", UserRole.PARENT)
    assert "family.parent" not in _keys(client, parent_headers)


def test_devices_unknown(db, client, parent, kid, parent_headers):
    db.add(Device(mac="aa:bb:cc:dd:ee:01", name="Mystery phone", status="unassigned"))
    db.commit()
    s = next(i for i in _get(client, parent_headers)["items"] if i["rule"] == "devices.unknown")
    assert "Mystery phone" in s["body"]


def test_feature_homework(db, client, parent, kid, parent_headers):
    _quiet(db, parent, kid)
    make_chore(db, parent, "Homework", kids=[kid])
    s = next(i for i in _get(client, parent_headers)["items"] if i["rule"] == "feature.homework")
    assert "Timmy" in s["body"]
    db.add(HomeworkRequest(kid_id=kid.id, status="approved"))
    db.commit()
    assert "feature.homework" not in [i["rule"] for i in _get(client, parent_headers)["items"]]


def _dismiss(client, h, rule):
    """Dismiss the live `rule` item; assert it is gone; return its key."""
    s = next(i for i in _get(client, h)["items"] if i["rule"] == rule)
    r = client.post(
        U + "/dismiss", json={"key": s["key"], "fingerprint": s["fingerprint"]}, headers=h
    )
    assert r.status_code == 200
    assert s["key"] not in _keys(client, h)
    return s["key"]


def test_chore_stale_reappears_on_new_cycle(db, client, parent, kid, parent_headers):
    _quiet(db, parent, kid)
    _, a = make_chore(db, parent, "Vacuum", kids=[kid])
    a.created_at = datetime.utcnow() - timedelta(days=30)
    db.commit()
    _runs(db, a, kid, ["done"], start=10)
    key = _dismiss(client, parent_headers, "chore.stale")
    _runs(db, a, kid, ["done"], start=8)  # done again, then stale again
    assert key in _keys(client, parent_headers)


def test_kid_cruising_reappears_on_new_last_day(db, client, parent, kid, parent_headers):
    from app.services.suggestions.engine import suggestions

    _quiet(db, parent, kid)
    _, a = make_chore(db, parent, "Dishes", kids=[kid])
    _runs(db, a, kid, ["done"] * 5, start=1)
    key = _dismiss(client, parent_headers, "kid.cruising")
    db.add(ChoreRun(assignment_id=a.id, day=TODAY, kid_id=kid.id, status="done"))
    db.commit()
    tomorrow = datetime.utcnow() + timedelta(days=1)  # window now ends on TODAY
    assert key in [i["key"] for i in suggestions(db, tomorrow)["items"]]


def test_goal_close_reappears_on_target_change(db, client, parent, kid, parent_headers):
    _quiet(db, parent, kid)
    g = Goal(name="Lego", kid_id=kid.id, target=100, status="active", created_by_id=parent.id)
    db.add(g)
    db.commit()
    db.add(
        GoalContribution(
            goal_id=g.id,
            kid_id=kid.id,
            amount=80,
            kind="save",
            created_at=datetime.utcnow() - timedelta(days=1),
        )
    )
    db.commit()
    key = _dismiss(client, parent_headers, "goal.close")
    g.target = 105
    db.commit()
    assert key in _keys(client, parent_headers)


def test_goal_missing_reappears_none_to_stalled(db, client, parent, kid, parent_headers):
    _old(db, parent, kid)
    _make_user(db, "dad", UserRole.PARENT)
    key = _dismiss(client, parent_headers, "goal.missing")
    db.add(
        Goal(
            name="Bike",
            kid_id=kid.id,
            target=500,
            status="active",
            created_by_id=parent.id,
            created_at=datetime.utcnow() - timedelta(days=20),
        )
    )
    db.commit()
    assert key in _keys(client, parent_headers)


def test_family_parent_stays_dismissed(db, client, parent, kid, parent_headers):
    _old(db, parent)
    key = _dismiss(client, parent_headers, "family.parent")
    assert key not in _keys(client, parent_headers)


def test_devices_unknown_reappears_on_new_device(db, client, parent, kid, parent_headers):
    db.add(Device(mac="aa:bb:cc:dd:ee:01", name="Phone", status="unassigned"))
    db.commit()
    key = _dismiss(client, parent_headers, "devices.unknown")
    db.add(Device(mac="aa:bb:cc:dd:ee:02", name="Tablet", status="unassigned"))
    db.commit()
    assert key in _keys(client, parent_headers)


def test_feature_homework_stays_dismissed(db, client, parent, kid, parent_headers):
    _quiet(db, parent, kid)
    make_chore(db, parent, "Homework", kids=[kid])
    key = _dismiss(client, parent_headers, "feature.homework")
    assert key not in _keys(client, parent_headers)


def test_deleted_kid_does_not_break_card(db, client, parent, kid, parent_headers):
    _quiet(db, parent, kid)
    _, a = make_chore(db, parent, "Dishes", kids=[kid])
    _runs(db, a, kid, ["skipped"] * 3)
    kid.is_active = False
    db.commit()
    assert client.get(U, headers=parent_headers).status_code == 200


def test_dismiss_after_mute_keeps_mute(db, client, parent, parent_headers):
    _old(db, parent)
    client.post(U + "/mute", json={"rule": "family.parent"}, headers=parent_headers)
    client.post(
        U + "/dismiss", json={"key": "family.parent", "fingerprint": "1"}, headers=parent_headers
    )
    assert "family.parent" not in _keys(client, parent_headers)


def test_max_three_ranked_system_first(db, client, parent, kid, parent_headers):
    _old(db, parent, kid)  # family.parent + goal.missing
    make_chore(db, parent, "Homework", kids=[kid])  # feature.homework
    db.add(Device(mac="aa:bb:cc:dd:ee:01", name="Mystery", status="unassigned"))
    db.commit()
    items = _get(client, parent_headers)["items"]
    assert len(items) == 3
    assert items[0]["rule"] == "devices.unknown"
    assert items[1]["rule"] == "goal.missing"  # kid-impacting before growth


def test_mute_rule_and_reset(db, client, parent, kid, parent_headers):
    _old(db, parent)
    r = client.post(U + "/mute", json={"rule": "family.parent"}, headers=parent_headers)
    assert r.status_code == 200
    assert "family.parent" not in _keys(client, parent_headers)
    assert client.delete(U + "/muted", headers=parent_headers).status_code == 200
    assert "family.parent" in _keys(client, parent_headers)


def test_cannot_mute_system_or_unknown(client, parent_headers):
    for rule in ("devices.unknown", "nope"):
        r = client.post(U + "/mute", json={"rule": rule}, headers=parent_headers)
        assert r.status_code == 400


def test_hide_and_show(db, client, parent, parent_headers):
    _old(db, parent)
    assert client.post(U + "/hide", headers=parent_headers).status_code == 200
    out = _get(client, parent_headers)
    assert out["hidden"] is True and out["items"] == []
    client.delete(U + "/hide", headers=parent_headers)
    assert _get(client, parent_headers)["hidden"] is False


def test_reset_muted_keeps_hidden(db, client, parent_headers):
    client.post(U + "/hide", headers=parent_headers)
    client.delete(U + "/muted", headers=parent_headers)
    assert _get(client, parent_headers)["hidden"] is True


def test_single_alembic_head():
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    cfg = Config("alembic.ini")
    heads = ScriptDirectory.from_config(cfg).get_heads()
    assert len(heads) == 1


def test_dismiss_rejects_invalid_or_internal_key(client, parent_headers):
    for key in ("Bad Key!", "_internal"):
        body = {"key": key, "fingerprint": "x"}
        r = client.post(U + "/dismiss", json=body, headers=parent_headers)
        assert r.status_code == 400


def test_chore_skipped_ignores_inactive_assignment(db, client, parent, kid, parent_headers):
    _quiet(db, parent, kid)
    _, a = make_chore(db, parent, "Dishes", kids=[kid])
    _runs(db, a, kid, ["skipped"] * 3)
    a.active = False
    db.commit()
    assert not any(k.startswith("chore.skipped") for k in _keys(client, parent_headers))


def test_chore_skipped_ignores_missing_kid(db, client, parent, kid, parent_headers):
    _quiet(db, parent, kid)
    _, a = make_chore(db, parent, "Dishes", kids=[kid])
    _runs(db, a, kid, ["skipped"] * 3)
    db.query(ChoreRun).update({ChoreRun.kid_id: 9999})
    db.commit()
    assert client.get(U, headers=parent_headers).status_code == 200
    assert not any(k.startswith("chore.skipped") for k in _keys(client, parent_headers))


def test_goal_close_skips_goal_without_target(db, client, parent, kid, parent_headers):
    _quiet(db, parent, kid)
    db.query(Goal).update({Goal.target: 0})
    db.commit()
    assert not any(k.startswith("goal.close") for k in _keys(client, parent_headers))


def test_goal_close_skips_missing_kid(db, client, parent, kid, parent_headers):
    _quiet(db, parent, kid)
    g = db.query(Goal).first()
    g.target = 7
    db.add(GoalContribution(goal_id=g.id, kid_id=kid.id, amount=4, kind="save"))
    db.commit()
    assert any(k.startswith("goal.close") for k in _keys(client, parent_headers))
    g.kid_id = 9999
    db.commit()
    assert not any(k.startswith("goal.close") for k in _keys(client, parent_headers))


def test_goal_missing_off_when_goals_disabled(db, client, parent, kid, parent_headers):
    from app.models.family import get_family

    _old(db, parent, kid)
    _make_user(db, "dad", UserRole.PARENT)
    assert "goal.missing:%d" % kid.id in _keys(client, parent_headers)
    get_family(db).goals_on = False
    db.commit()
    assert not any(k.startswith("goal.missing") for k in _keys(client, parent_headers))
