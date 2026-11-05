import json

import pytest
from app.integrations import store
from app.integrations.apply import MAX_REWARDS, apply_actions
from app.models.inbox import Notification
from app.models.integration import IntegrationAction
from app.models.reward import Reward
from tests.integrations.int_helpers import msg, ru

PERMS = pytest.mark.parametrize("install", [["rewards.manage", "messages.parents"]], indirect=True)
pytestmark = PERMS


def test_upsert_creates_then_updates(db, install):
    apply_actions(db, install, [ru("a", ref="r1", name="Robux", price=50)])
    apply_actions(db, install, [ru("b", ref="r1", name="Robux 2", price=60)])
    [r] = db.query(Reward).filter_by(integration_install_id=install.id).all()
    assert (r.name, r.price, r.needs_approval) == ("Robux 2", 60, True)


def test_cannot_touch_core_reward(db, install):
    core = Reward(name="Park", price=10)
    db.add(core)
    db.commit()
    act = {"type": "reward.remove", "idempotency_key": "x", "ref": str(core.id)}
    [res] = apply_actions(db, install, [act])
    assert res.reason == "no such reward" and core.active is True


def test_cannot_touch_other_integrations_reward(db, install):
    other = Reward(name="Theirs", price=5, integration_install_id=None, integration_ref="r1")
    db.add(other)
    db.commit()
    [res] = apply_actions(
        db, install, [{"type": "reward.remove", "idempotency_key": "x", "ref": "r1"}]
    )
    assert res.reason == "no such reward" and other.active is True
    apply_actions(db, install, [ru("u", ref="r1", name="Mine")])
    db.refresh(other)
    assert other.name == "Theirs"


def test_remove_then_upsert_creates_new(db, install):
    apply_actions(db, install, [ru("a", ref="r1")])
    apply_actions(db, install, [{"type": "reward.remove", "idempotency_key": "d", "ref": "r1"}])
    [res] = apply_actions(db, install, [ru("b", ref="r1")])
    assert res.result == "applied"
    assert db.query(Reward).filter_by(integration_install_id=install.id, active=True).count() == 1


def test_parent_removal_sticks(db, install, client, parent_headers):
    apply_actions(db, install, [ru("a", ref="r1")])
    rid = db.query(Reward).filter_by(integration_ref="r1").one().id
    client.delete(f"/api/v1/rewards/{rid}", headers=parent_headers)
    assert apply_actions(db, install, [ru("b", ref="r1")])[0].reason == (
        "a parent removed this reward"
    )


def test_reward_cap(db, install):
    apply_actions(db, install, [ru(f"k{i}", ref=f"r{i}") for i in range(MAX_REWARDS)][:20])
    apply_actions(db, install, [ru(f"j{i}", ref=f"s{i}") for i in range(MAX_REWARDS - 20)])
    assert apply_actions(db, install, [ru("over", ref="zz")])[0].reason == "too many rewards"


def test_api_lists_integration(db, install, client, parent_headers):
    apply_actions(db, install, [ru("a", ref="r1", name="Robux")])
    rows = client.get("/api/v1/rewards", headers=parent_headers).json()
    assert rows[0]["integration"] == {"id": install.id, "name": "Demo"}


def test_linked_kid_sees_and_unlinked_does_not(db, install, client, kid_headers, other_kid_headers):
    apply_actions(db, install, [ru("a", ref="r1", name="Robux")])

    def names(h):
        return [r["name"] for r in client.get("/api/v1/kid/rewards", headers=h).json()["rewards"]]

    assert "Robux" in names(kid_headers)
    assert "Robux" not in names(other_kid_headers)


def test_unlinked_kid_cannot_redeem(db, install, client, other_kid_headers):
    apply_actions(db, install, [ru("a", ref="r1", name="Robux", price=1)])
    rid = db.query(Reward).filter_by(integration_ref="r1").one().id
    r = client.post(
        "/api/v1/kid/redeem", json={"kind": "reward", "reward_id": rid}, headers=other_kid_headers
    )
    assert r.status_code == 400


def test_visibility_follows_install_status(db, install, kid):
    apply_actions(db, install, [ru("a", ref="r1")])
    r = db.query(Reward).filter_by(integration_ref="r1").one()
    install.status = "paused"
    assert store.reward_visible_to(db, r, kid.id)
    install.status = "removed"
    assert not store.reward_visible_to(db, r, kid.id)


def test_message_reaches_parents_with_name(db, install):
    apply_actions(db, install, [msg("m1", title="Streak!", body="Sam hit 30 days")])
    n = db.query(Notification).filter_by(kind="integration_msg").first()
    assert n.title == "Demo: Streak!" and n.body == "Sam hit 30 days"


def test_message_control_chars_stripped(db, install):
    apply_actions(db, install, [msg("m1", title="a\x00b\nc", body="x\x1b[31my")])
    n = db.query(Notification).filter_by(kind="integration_msg").first()
    assert n.title == "Demo: ab c" and n.body == "x[31my"


def test_message_daily_cap(db, install):
    apply_actions(db, install, [msg(f"m{i}") for i in range(20)])
    assert apply_actions(db, install, [msg("m20")])[0].reason == "too many messages today"
    assert db.query(Notification).filter_by(kind="integration_msg").count() % 20 == 0


def test_audited(db, install):
    apply_actions(db, install, [ru("a"), msg("m")])
    kinds = {a.kind: a.result for a in db.query(IntegrationAction).filter_by(install_id=install.id)}
    assert kinds == {"reward.upsert": "applied", "message.parents": "applied"}


def test_without_grant_rejected(db, install):
    install.permissions = json.dumps([])
    db.commit()
    assert apply_actions(db, install, [ru("a")])[0].result == "rejected"
    assert db.query(Reward).filter_by(integration_install_id=install.id).count() == 0
