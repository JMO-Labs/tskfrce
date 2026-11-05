"""Events out: who gets an event, what it carries, and how the outbox is delivered."""

import json
import secrets
from datetime import UTC, datetime, timedelta

import pytest
from app.core.crypto import seal
from app.integrations import events, loop, store
from app.integrations.apply import apply_actions
from app.integrations.events import trim
from app.models.integration import (
    IntegrationAction,
    IntegrationChore,
    IntegrationEvent,
    IntegrationInstall,
    IntegrationKid,
)
from app.models.points import Points, PointsType
from app.models.reward import Reward
from app.services import chore_actions, economy
from app.services.chat_extras import first_name
from tests.factories import make_run
from tests.integrations.int_helpers import (
    DEMO,
    add_events,
    boom,
    cc,
    kid_requests_screen_time,
    sign_env,
)

NOW = datetime.now(UTC).replace(tzinfo=None)
EV = ["events.chore_completed", "events.request_created", "events.reward_redeemed"]
events_only = pytest.mark.parametrize("install", [EV], indirect=True)
with_names = pytest.mark.parametrize(
    "install", [[*EV, "kid.name", "chores.complete"]], indirect=True
)


def _payloads(db, install=None):
    q = db.query(IntegrationEvent).order_by(IntegrationEvent.id)
    if install is not None:
        q = q.filter_by(install_id=install.id)
    return [json.loads(e.payload) for e in q]


def _second_install(db, parent, kid, chore_id, perms):
    inst = IntegrationInstall(
        public_id=secrets.token_hex(16),
        source="catalog",
        integration_id="other",
        name="Other",
        icon="extension",
        manifest=json.dumps(sign_env(DEMO)),
        permissions=json.dumps(perms),
        secret=seal(secrets.token_urlsafe(32), purpose="integrations"),
        status="active",
        created_by_id=parent.id,
    )
    db.add(inst)
    db.flush()
    db.add_all(
        [
            IntegrationKid(install_id=inst.id, kid_id=kid.id),
            IntegrationChore(install_id=inst.id, chore_id=chore_id),
        ]
    )
    db.commit()
    return inst


@events_only
def test_approval_emits_trimmed_event(db, install, kid, run_today, parent):
    chore_actions.approve(db, run_today, parent.id)
    db.commit()
    [ev] = db.query(IntegrationEvent).all()
    p = json.loads(ev.payload)
    assert p["kind"] == "chore.completed" and p["kid_id"] == kid.id and "first_name" not in p
    assert set(p) <= {"kind", "at", "kid_id", "chore_id", "title", "points"}
    assert "title" not in p  # chore titles only with chores.complete
    assert p["chore_id"] == run_today.chore_id and p["points"] == 10


@with_names
def test_names_and_titles_only_with_their_permissions(db, install, kid, run_today, parent):
    chore_actions.approve(db, run_today, parent.id)
    db.commit()
    [p] = _payloads(db)
    assert p["first_name"] == first_name(kid) and p["title"] == "Dishes"


@events_only
def test_unlinked_kid_gets_no_event(db, install, other_kid, parent):
    run = make_run(db, parent, other_kid, status="submitted")
    chore_actions.approve(db, run, parent.id)
    db.commit()
    assert db.query(IntegrationEvent).count() == 0


@events_only
def test_unlinked_chore_gets_no_event(db, install, kid, parent):
    run = make_run(db, parent, kid, status="submitted", title="Not linked")
    chore_actions.approve(db, run, parent.id)
    db.commit()
    assert db.query(IntegrationEvent).count() == 0


@pytest.mark.parametrize("install", [["chores.complete", "kid.name"]], indirect=True)
def test_no_event_permission_no_event(db, install, run_today, parent):
    chore_actions.approve(db, run_today, parent.id)
    db.commit()
    assert db.query(IntegrationEvent).count() == 0


@pytest.mark.parametrize("status", ["paused", "revoked", "removed"])
@events_only
def test_inactive_install_gets_no_event(db, install, run_today, parent, status):
    install.status = status
    db.commit()
    chore_actions.approve(db, run_today, parent.id)
    db.commit()
    assert db.query(IntegrationEvent).count() == 0


@events_only
def test_screen_time_request_emits_nothing(client, kid_headers, install, db):
    kid_requests_screen_time(client, kid_headers)
    assert db.query(IntegrationEvent).count() == 0


@events_only
def test_reward_redeemed_has_name_and_cost_only(db, install, kid, reward_redemption, parent):
    economy.decide(db, reward_redemption, parent, True)
    p = json.loads(db.query(IntegrationEvent).one().payload)
    assert p["reward_name"] == "Ice cream" and p["cost"] == 20 and "balance" not in p
    assert set(p) == {"kind", "at", "kid_id", "reward_name", "cost"}


@events_only
def test_denied_reward_emits_nothing(db, install, reward_redemption, parent):
    economy.decide(db, reward_redemption, parent, False)
    assert db.query(IntegrationEvent).count() == 0


@events_only
def test_reward_request_emits_request_created(db, install, kid):
    rw = Reward(name="Ice cream", price=20, needs_approval=True)
    db.add(rw)
    db.add(Points(user_id=kid.id, points_type=PointsType.BONUS, amount=100, description="t"))
    db.commit()
    red = economy.request(db, kid, "reward", rw.id, None)
    [p] = _payloads(db)
    assert p["kind"] == "request.created" and p["kid_id"] == kid.id
    assert {k: p[k] for k in ("type", "id", "title", "cost")} == {
        "type": "reward",
        "id": red.id,
        "title": "Ice cream",
        "cost": 20,
    }


@events_only
def test_kid_check_off_emits_chore_request(client, db, install, kid, kid_headers, run_today):
    r = client.post(f"/api/v1/kid/chores/{run_today.id}/done", headers=kid_headers)
    assert r.status_code == 200, r.text
    [p] = _payloads(db)
    assert p["kind"] == "request.created" and p["type"] == "chore" and p["id"] == run_today.id
    assert "title" not in p and "cost" not in p


@pytest.mark.parametrize("install", [["chores.complete", "events.request_created"]], indirect=True)
def test_pending_completion_skips_its_own_install(db, install, kid, parent, run_today):
    other = _second_install(db, parent, kid, run_today.chore_id, ["events.request_created"])
    [res] = apply_actions(db, install, [cc("k1", kid.id, run_today.chore_id)])
    assert res.result == "pending"
    assert _payloads(db, install) == []
    [p] = _payloads(db, other)
    assert p["type"] == "chore" and p["id"] == run_today.id and "title" not in p


@events_only
def test_emit_failure_never_breaks_approval(db, install, run_today, parent, monkeypatch):
    monkeypatch.setattr(events, "trim", boom)
    chore_actions.approve(db, run_today, parent.id)
    db.commit()
    assert run_today.status == "done"
    assert db.query(IntegrationEvent).count() == 0


@events_only
def test_flush_delivers_batches_of_50_and_applies_reply(db, install, svc, kid):
    svc.secret = store.secret_of(install)
    add_events(db, install, 60)
    events.flush(db, NOW)
    assert len(svc.last_body["events"]) == 50 and db.query(IntegrationEvent).count() == 10


@pytest.mark.parametrize("install", [[*EV, "chores.complete"]], indirect=True)
def test_flush_reply_actions_go_through_apply(db, install, svc, kid, run_today):
    svc.secret = store.secret_of(install)
    svc.actions = [cc("e1", kid.id, run_today.chore_id)]
    add_events(db, install, 1)
    events.flush(db, NOW)
    row = db.query(IntegrationAction).one()
    assert (row.idempotency_key, row.result) == ("e1", "pending")


@events_only
def test_failed_batch_stays_for_retry(db, install, svc):
    svc.secret = store.secret_of(install)
    svc.fail()
    add_events(db, install, 3)
    events.flush(db, NOW)
    rows = db.query(IntegrationEvent).all()
    assert len(rows) == 3 and {r.attempts for r in rows} == {1}
    assert install.failures == 1


@events_only
def test_outbox_is_capped_per_install(db, install, svc):
    svc.fail()
    add_events(db, install, events.MAX_QUEUED + 10)
    events.flush(db, NOW)
    ids = [e.id for e in db.query(IntegrationEvent).order_by(IntegrationEvent.id)]
    assert len(ids) == events.MAX_QUEUED and ids[0] > 10  # the oldest went first


@events_only
def test_paused_install_queue_is_not_sent(db, install, svc):
    add_events(db, install, 2)
    install.status = "paused"
    db.commit()
    events.flush(db, NOW)
    assert svc.last_body is None and db.query(IntegrationEvent).count() == 2


@events_only
def test_unlinked_since_queued_is_dropped_not_sent(db, install, svc, kid):
    add_events(db, install, 2)
    db.query(IntegrationKid).filter_by(install_id=install.id).delete()
    db.commit()
    events.flush(db, NOW)
    assert svc.last_body is None and db.query(IntegrationEvent).count() == 0


@events_only
def test_old_events_dropped(db, install):
    add_events(db, install, 1, created_at=NOW - timedelta(hours=25))
    events.flush(db, NOW)
    assert db.query(IntegrationEvent).count() == 0


@events_only
def test_trim_uses_given_time(db, install, kid):
    p = trim(
        store.load_grant(db, install), "chore.completed", kid.id, "Sam", {"chore_id": 9}, at=NOW
    )
    assert p["at"] == NOW.isoformat()


def test_flush_is_a_loop_step():
    assert events.flush in loop.STEPS
