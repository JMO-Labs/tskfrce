"""Goal tables: rows, sums and CHECK constraints."""

import pytest
from app.models import FamilySettings, Points, PointsType
from app.models.goal import Goal, GoalAuto, GoalContribution, GoalParty
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError


def _goal(parent, **kw):
    base = {"name": "Bike", "kind": "custom", "status": "active", "created_by_id": parent.id}
    return Goal(**{**base, **kw})


def test_family_and_kid_goal_sums(db, parent, kid):
    fam = _goal(parent, target=100)
    mine = _goal(parent, kid_id=kid.id, target=50)
    db.add_all([fam, mine])
    db.flush()
    db.add_all(
        [
            GoalContribution(goal_id=fam.id, kid_id=kid.id, amount=30, kind="save"),
            GoalContribution(
                goal_id=fam.id, kid_id=None, by_id=parent.id, amount=20, kind="chip_in"
            ),
            GoalContribution(goal_id=fam.id, kid_id=kid.id, amount=-5, kind="return"),
            GoalContribution(goal_id=mine.id, kid_id=kid.id, amount=10, kind="auto"),
            GoalAuto(kid_id=kid.id, goal_id=mine.id),
            GoalParty(goal_id=mine.id, kid_id=kid.id),
        ]
    )
    db.commit()
    total = db.scalar(
        select(func.sum(GoalContribution.amount)).where(GoalContribution.goal_id == fam.id)
    )
    assert total == 45
    assert fam.kid_id is None


@pytest.mark.parametrize("kw", [{"status": "bogus"}, {"kind": "bogus"}])
def test_bad_goal_values_rejected(db, parent, kw):
    db.add(_goal(parent, **kw))
    with pytest.raises(IntegrityError):
        db.commit()


def test_bad_contribution_kind_rejected(db, parent):
    g = _goal(parent)
    db.add(g)
    db.flush()
    db.add(GoalContribution(goal_id=g.id, amount=1, kind="bogus"))
    with pytest.raises(IntegrityError):
        db.commit()


@pytest.mark.parametrize("reason", ["goal_save", "goal_return"])
def test_points_goal_reasons_commit(db, kid, reason):
    db.add(Points(user_id=kid.id, points_type=PointsType.TRANSFER, amount=-5, reason=reason))
    db.commit()


def test_family_settings_goal_defaults(db):
    f = FamilySettings(id=1)
    db.add(f)
    db.commit()
    db.refresh(f)
    assert (f.goals_on, f.goal_suggest, f.goal_withdraw, f.goal_siblings) == (
        True,
        True,
        True,
        False,
    )
    assert (f.goal_auto, f.goal_auto_pct) == (False, 25)
    assert (f.goal_max_little, f.goal_max_kid, f.goal_max_teen) == (1, 2, 3)
    assert (f.goal_screen_on, f.goal_screen_price, f.goal_screen_minutes) == (False, 200, 60)
    assert (f.goal_jail_on, f.goal_jail_price) == (False, 500)
