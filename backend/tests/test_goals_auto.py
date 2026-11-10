"""Auto-share: a slice of each approval goes to the kid's goal."""

from app.models.family import get_family
from app.models.goal import Goal, GoalAuto, GoalContribution
from app.models.points import Points, PointsType
from app.services import economy, goals, goals_auto


def _goal(db, parent, kid, target=100, name="Bike", status="active"):
    g = Goal(name=name, kid_id=kid.id, target=target, status=status, created_by_id=parent.id)
    db.add(g)
    db.commit()
    return g


def _on(db, pct=25):
    fam = get_family(db)
    fam.goals_on, fam.goal_auto, fam.goal_auto_pct = True, True, pct
    db.commit()


def _earn(db, kid, n):
    db.add(Points(user_id=kid.id, points_type=PointsType.BONUS, amount=n, description="t"))
    db.flush()
    goals_auto.auto_share(db, kid.id, n)
    db.commit()


def test_auto_share_caps_and_fallbacks(db, parent, kid):
    _on(db)
    # no goal: nothing moves
    _earn(db, kid, 100)
    assert economy.balance(db, kid.id) == 100
    old = _goal(db, parent, kid, target=100, name="Old")
    new = _goal(db, parent, kid, target=100, name="New")
    # no GoalAuto: oldest active own goal
    _earn(db, kid, 100)
    assert goals.saved(db, old.id) == 25 and goals.saved(db, new.id) == 0
    # chosen goal wins
    db.add(GoalAuto(kid_id=kid.id, goal_id=new.id))
    db.commit()
    _earn(db, kid, 40)
    assert goals.saved(db, new.id) == 10
    # capped at remaining
    new.target = 12
    db.commit()
    _earn(db, kid, 100)
    assert goals.saved(db, new.id) == 12 and new.status == "full"
    # chosen goal not active (full): falls back to oldest active
    _earn(db, kid, 100)
    assert goals.saved(db, old.id) == 50
    kinds = {c.kind for c in db.query(GoalContribution)}
    assert kinds == {"auto"}
    row = db.query(Points).filter(Points.reason == "goal_save").first()
    assert row.points_type == PointsType.TRANSFER and row.description.startswith("Saved to ")


def test_auto_share_off(db, parent, kid):
    g = _goal(db, parent, kid)
    fam = get_family(db)
    fam.goals_on, fam.goal_auto = True, False
    db.commit()
    _earn(db, kid, 100)
    assert goals.saved(db, g.id) == 0
    fam.goals_on, fam.goal_auto = False, True
    db.commit()
    _earn(db, kid, 100)
    assert goals.saved(db, g.id) == 0


def test_chore_approval_auto_shares(db, parent, kid):
    from datetime import date

    from tests.factories import make_run

    _on(db)
    g = _goal(db, parent, kid)
    run = make_run(db, parent, kid, day=date(2026, 10, 20))
    run.assignment.chore.points = 100
    db.commit()
    economy.award_chore(db, run, get_family(db))
    db.commit()
    assert goals.saved(db, g.id) == 25
    assert economy.balance(db, kid.id) == 75
