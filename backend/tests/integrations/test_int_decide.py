import json

import pytest
from app.integrations.apply import apply_actions
from app.models.integration import IntegrationAction
from app.models.lock import Override
from app.models.points import Points
from app.models.reward import Redemption, Reward
from app.services import economy
from tests.factories import make_run
from tests.integrations.int_helpers import boom, rd

pytestmark = pytest.mark.parametrize("install", [["requests.decide"]], indirect=True)


def _audit(db, key="a") -> IntegrationAction:
    return db.query(IntegrationAction).filter_by(idempotency_key=key).one()


def test_approves_reward_redemption(db, install, reward_redemption):
    [r] = apply_actions(db, install, [rd("a", "reward", reward_redemption.id, True)])
    assert r.result == "applied" and reward_redemption.status == "approved"
    assert reward_redemption.auto is False and reward_redemption.decided_by_id is None
    row = _audit(db)
    assert (row.kind, row.redemption_id, row.kid_id) == (
        "request.decide",
        reward_redemption.id,
        reward_redemption.kid_id,
    )


def test_denies_reward_redemption_with_note(db, install, reward_redemption):
    [r] = apply_actions(db, install, [rd("a", "reward", reward_redemption.id, False, "Not now")])
    assert r.result == "applied" and reward_redemption.status == "denied"
    assert (reward_redemption.note, reward_redemption.auto) == ("Not now", False)
    assert db.query(Points).filter_by(redemption_id=reward_redemption.id).count() == 0


def test_screen_time_never_approvable(db, install, screen_time_redemption):
    before = db.query(Override).count()
    [r] = apply_actions(db, install, [rd("a", "reward", screen_time_redemption.id, True)])
    assert (r.result, r.reason) == ("rejected", "only the t@sk4ce app can answer this")
    assert screen_time_redemption.status == "pending" and db.query(Override).count() == before


def test_screen_time_never_deniable(db, install, screen_time_redemption):
    [r] = apply_actions(db, install, [rd("a", "reward", screen_time_redemption.id, False)])
    assert r.reason == "only the t@sk4ce app can answer this"
    assert screen_time_redemption.status == "pending"


@pytest.mark.parametrize(
    "target", ["homework", "screen_time", "device", "unlock", "extra_time", "redemption"]
)
def test_other_targets_do_not_exist(db, install, target):
    assert apply_actions(db, install, [rd("a", target, 1, True)])[0].reason == "bad action"


def test_trust_switch_does_not_gate_decide(db, install, reward_redemption):
    install.trusted = False
    assert (
        apply_actions(db, install, [rd("a", "reward", reward_redemption.id, False)])[0].result
        == "applied"
    )


def test_race_with_parent(db, install, reward_redemption, parent):
    economy.decide(db, reward_redemption, parent, False)
    [r] = apply_actions(db, install, [rd("a", "reward", reward_redemption.id, True)])
    assert (r.result, r.reason) == (
        "rejected",
        "already answered",
    ) and reward_redemption.status == "denied"
    assert _audit(db).redemption_id == reward_redemption.id


def test_race_lost_inside_economy(db, install, reward_redemption, parent, monkeypatch):
    """A parent answers between the handler's check and economy's locked re-check."""
    real = economy.decide

    def parent_first(db_, r, *args):
        db_.query(Redemption).filter_by(id=r.id).update(
            {"status": "denied", "decided_by_id": parent.id}, synchronize_session=False
        )
        return real(db_, r, *args)

    monkeypatch.setattr(economy, "decide", parent_first)
    [r] = apply_actions(db, install, [rd("a", "reward", reward_redemption.id, True)])
    assert (r.result, r.reason) == ("rejected", "already answered")
    db.refresh(reward_redemption)
    assert reward_redemption.status == "denied" and reward_redemption.decided_by_id == parent.id
    assert db.query(Points).filter_by(redemption_id=reward_redemption.id).count() == 0


def test_crash_mid_decision_rolls_back(db, install, reward_redemption, monkeypatch):
    monkeypatch.setattr(economy.inbox, "notify", boom)
    [r] = apply_actions(db, install, [rd("a", "reward", reward_redemption.id, True)])
    assert (r.result, r.reason) == ("rejected", "internal error")
    db.refresh(reward_redemption)
    assert reward_redemption.status == "pending"
    assert db.query(Points).filter_by(redemption_id=reward_redemption.id).count() == 0
    assert _audit(db).result == "rejected"


def test_already_decided_is_idempotent(db, install, reward_redemption):
    first = apply_actions(db, install, [rd("a", "reward", reward_redemption.id, True)])
    again = apply_actions(db, install, [rd("a", "reward", reward_redemption.id, True)])
    other = apply_actions(db, install, [rd("b", "reward", reward_redemption.id, False)])
    assert first[0].result == again[0].result == "applied"
    assert (other[0].result, other[0].reason) == ("rejected", "already answered")
    assert reward_redemption.status == "approved"
    assert db.query(Points).filter_by(redemption_id=reward_redemption.id).count() == 1


def test_removed_reward_rejected_with_detail(db, install, reward_redemption):
    db.get(Reward, reward_redemption.reward_id).active = False
    db.commit()
    [r] = apply_actions(db, install, [rd("a", "reward", reward_redemption.id, True)])
    assert (r.result, r.reason) == ("rejected", "That reward was removed.")
    assert (
        reward_redemption.status == "pending" and _audit(db).redemption_id == reward_redemption.id
    )


def test_missing_redemption_not_found(db, install):
    assert apply_actions(db, install, [rd("a", "reward", 9999, True)])[0].reason == "not found"


def test_unlinked_kid_redemption_not_found(db, install, other_kid_redemption):
    assert (
        apply_actions(db, install, [rd("a", "reward", other_kid_redemption.id, True)])[0].reason
        == "not found"
    )
    assert other_kid_redemption.status == "pending"


def test_chore_approve(db, install, kid, run_submitted):
    [r] = apply_actions(db, install, [rd("a", "chore", run_submitted.id, True)])
    assert r.result == "applied" and run_submitted.status == "done"
    assert run_submitted.approved_by_id is None
    assert db.query(Points).filter_by(user_id=kid.id).count() == 1
    row = _audit(db)
    assert (row.run_id, row.kid_id, row.chore_id) == (
        run_submitted.id,
        kid.id,
        run_submitted.chore_id,
    )


def test_chore_send_back_with_default_note(db, install, kid, run_submitted):
    apply_actions(db, install, [rd("a", "chore", run_submitted.id, False)])
    assert run_submitted.status == "todo" and run_submitted.last_note == "Sent back by Demo"


def test_chore_send_back_with_note(db, install, run_submitted):
    apply_actions(db, install, [rd("a", "chore", run_submitted.id, False, "Redo it")])
    assert run_submitted.last_note == "Redo it"


def test_chore_not_submitted_already_answered(db, install, run_today):
    [r] = apply_actions(db, install, [rd("a", "chore", run_today.id, True)])
    assert (r.result, r.reason) == ("rejected", "already answered") and run_today.status == "todo"


def test_chore_decided_once(db, install, kid, run_submitted):
    apply_actions(db, install, [rd("a", "chore", run_submitted.id, True)])
    [r] = apply_actions(db, install, [rd("b", "chore", run_submitted.id, False)])
    assert r.reason == "already answered" and run_submitted.status == "done"
    assert db.query(Points).filter_by(user_id=kid.id).count() == 1


def test_unlinked_kid_run_not_found(db, install, parent, other_kid):
    run = make_run(db, parent, other_kid, status="submitted")
    [r] = apply_actions(db, install, [rd("a", "chore", run.id, True)])
    assert r.reason == "not found" and run.status == "submitted"


def test_unlinked_chore_run_not_found(db, install, parent, kid):
    run = make_run(db, parent, kid, status="submitted")
    [r] = apply_actions(db, install, [rd("a", "chore", run.id, True)])
    assert r.reason == "not found" and run.status == "submitted"


def test_missing_run_not_found(db, install):
    assert apply_actions(db, install, [rd("a", "chore", 9999, True)])[0].reason == "not found"


def test_kid_button_cannot_decide(db, install, kid, reward_redemption):
    [r] = apply_actions(
        db,
        install,
        [rd("a", "reward", reward_redemption.id, True)],
        origin="kid_button",
        actor_kid_id=kid.id,
    )
    assert r.reason == "kids can only ask"


def test_kid_button_cannot_decide_chore(db, install, kid, run_submitted):
    [r] = apply_actions(
        db,
        install,
        [rd("a", "chore", run_submitted.id, True)],
        origin="kid_button",
        actor_kid_id=kid.id,
    )
    assert r.reason == "kids can only ask" and run_submitted.status == "submitted"


def test_needs_the_permission(db, install, reward_redemption):
    install.permissions = json.dumps(["chores.complete"])
    db.commit()
    assert (
        apply_actions(db, install, [rd("a", "reward", reward_redemption.id, True)])[0].reason
        == "not allowed"
    )
