from app.integrations import apply as apply_mod
from app.integrations import audit, store
from app.integrations.apply import apply_actions
from app.models.chores import ChoreRun
from app.models.inbox import Notification
from app.models.integration import IntegrationAction, IntegrationKid
from app.models.lock import Override
from app.models.points import Points
from app.services.economy import balance
from fastapi import HTTPException
from sqlalchemy import update
from tests.factories import make_chore
from tests.integrations.int_helpers import DEMO, cc


def test_untrusted_completion_goes_to_needs_you(db, install, kid, run_today):
    [r] = apply_actions(db, install, [cc("k1", kid.id, run_today.chore_id)])
    assert r.result == "pending" and run_today.status == "submitted"
    assert db.query(Notification).filter_by(kind="chore_submitted", run_id=run_today.id).count()
    assert not db.query(Points).filter_by(run_id=run_today.id).count()


def test_trusted_completion_awards(db, install, kid, run_today):
    install.trusted = True
    [r] = apply_actions(db, install, [cc("k1", kid.id, run_today.chore_id)])
    assert r.result == "applied" and run_today.status == "done" and balance(db, kid.id) > 0


def test_kid_button_completion_waits_even_when_trusted(db, install, kid, run_today):
    install.trusted = True
    a = cc("k1", kid.id, run_today.chore_id)
    [r] = apply_actions(db, install, [a], origin="kid_button", actor_kid_id=kid.id)
    assert r.result == "pending" and run_today.status == "submitted"


def test_duplicate_key_applies_once(db, install, kid, run_today):
    install.trusted = True
    a = cc("k1", kid.id, run_today.chore_id)
    first = apply_actions(db, install, [a])
    again = apply_actions(db, install, [a, a])
    assert [x.result for x in again] == [first[0].result] * 2
    assert db.query(Points).filter_by(run_id=run_today.id).count() == 1
    assert db.query(IntegrationAction).count() == 1


def test_concurrent_duplicate_does_not_double_pay(db, install, kid, run_today, monkeypatch):
    """A racer that missed the prior row loses on the unique key and is rolled back."""
    install.trusted = True
    a = cc("k1", kid.id, run_today.chore_id)
    [first] = apply_actions(db, install, [a])
    run_today.status = "todo"  # the racer read the run before the winner committed
    db.commit()
    real_prior, calls = audit.prior, []

    def racy_prior(db_, install_id, key):
        calls.append(key)
        return None if len(calls) == 1 else real_prior(db_, install_id, key)

    monkeypatch.setattr(audit, "prior", racy_prior)
    [again] = apply_actions(db, install, [a])
    assert (again.result, again.reason) == (first.result, first.reason)
    assert db.query(Points).filter_by(run_id=run_today.id).count() == 1
    assert db.query(IntegrationAction).count() == 1


def test_audit_time_matches_submission(db, install, kid, run_today):
    apply_actions(db, install, [cc("k1", kid.id, run_today.chore_id)])
    row = db.query(IntegrationAction).one()
    assert row.created_at == run_today.submitted_at
    assert (row.kid_id, row.chore_id, row.run_id) == (kid.id, run_today.chore_id, run_today.id)


def test_nothing_to_do_when_already_submitted(db, install, kid, run_today):
    run_today.status = "submitted"
    db.commit()
    [r] = apply_actions(db, install, [cc("k1", kid.id, run_today.chore_id)])
    assert (r.result, r.reason) == ("rejected", "nothing to do today")


def test_handler_http_error_is_rejected_and_rolled_back(db, install, kid, run_today, monkeypatch):
    def boom(db_, install_, grant, action, needs_approval):
        db_.add(Points(user_id=kid.id, amount=5, points_type="bonus", description="x"))
        db_.flush()
        raise HTTPException(409, "too late")

    monkeypatch.setitem(apply_mod.HANDLERS, "chore.complete", boom)
    [r] = apply_actions(db, install, [cc("k1", kid.id, run_today.chore_id)])
    assert (r.result, r.reason) == ("rejected", "too late")
    assert balance(db, kid.id) == 0


def test_unlinked_kid_rejected_after_unlink(db, install, kid, run_today):
    db.query(IntegrationKid).delete()
    db.commit()
    [r] = apply_actions(db, install, [cc("k2", kid.id, run_today.chore_id)])
    assert (r.result, r.reason) == ("rejected", "kid not linked") and run_today.status == "todo"


def test_unknown_action_logged_and_nothing_changes(db, install):
    before = db.query(Override).count()
    [r] = apply_actions(db, install, [{"type": "device.unlock", "idempotency_key": "x"}])
    assert (r.result, r.reason) == ("rejected", "unknown action")
    assert db.query(Override).count() == before
    assert db.query(IntegrationAction).one().kind == "device.unlock"


def test_one_bad_action_does_not_block_others(db, install, kid, run_today):
    rs = apply_actions(
        db,
        install,
        [{"type": "nope", "idempotency_key": "a"}, cc("b", kid.id, run_today.chore_id)],
    )
    assert [r.result for r in rs] == ["rejected", "pending"]


def test_bad_keys_and_long_types_are_audited(db, install):
    rs = apply_actions(
        db, install, [{"type": "x" * 40}, {"type": "x" * 40, "idempotency_key": "bad key!"}]
    )
    assert [r.result for r in rs] == ["rejected"] * 2 and db.query(IntegrationAction).count() == 2
    assert all(
        a.idempotency_key.startswith("invalid:") and len(a.kind) == 24
        for a in db.query(IntegrationAction)
    )


def test_paused_install_rejects(db, install, kid, run_today):
    install.status = "paused"
    assert (
        apply_actions(db, install, [cc("k", kid.id, run_today.chore_id)])[0].reason
        == "integration is paused"
    )


def test_secret_sealed_at_rest(db, install):
    s = store.new_secret()
    install.secret = store.seal_secret(s)
    assert s not in install.secret and store.secret_of(install) == s and len(s) >= 43
    assert store.client_for(db, install).ctx.base_url == DEMO["base_url"]  # pinned manifest


def test_client_uses_test_transport_and_grant(db, install, kid, monkeypatch):
    sentinel = object()
    monkeypatch.setattr(store, "_transport", sentinel)
    c = store.client_for(db, install)
    assert c.transport is sentinel
    assert c.ctx.grant_out["kids"] == [{"id": kid.id}]
    assert [ch["id"] for ch in c.ctx.grant_out["chores"]] == [install.chores[0].chore_id]


def test_load_grant_reads_the_box(db, install, kid):
    g = store.load_grant(db, install)
    assert g.kid_ids == {kid.id} and g.chore_ids == {install.chores[0].chore_id}
    assert g.permissions == {"chores.complete"} and g.active and not g.trusted


def test_concurrent_completion_with_another_key_does_not_double_pay(
    db, install, kid, run_today, monkeypatch
):
    """The run turns submitted (kid's /done, another key) between the read and the write."""
    install.trusted = True
    real = apply_mod._todays_run

    def racing(db_, a, now):
        run = real(db_, a, now)
        stmt = update(ChoreRun).where(ChoreRun.id == run.id).values(status="submitted")
        db_.execute(stmt.execution_options(synchronize_session=False))
        return run  # in-memory status is still the stale "todo"

    monkeypatch.setattr(apply_mod, "_todays_run", racing)
    [r] = apply_actions(db, install, [cc("k1", kid.id, run_today.chore_id)])
    assert (r.result, r.reason) == ("rejected", "nothing to do today")
    assert balance(db, kid.id) == 0 and not db.query(Points).filter_by(run_id=run_today.id).count()


def test_unexpected_handler_error_is_audited_and_batch_continues(
    db, install, kid, run_today, monkeypatch
):
    calls = []

    def flaky(db_, install_, grant, action, needs_approval):
        calls.append(action.idempotency_key)
        if len(calls) == 1:
            db_.add(Points(user_id=kid.id, amount=5, points_type="bonus", description="x"))
            db_.flush()
            raise RuntimeError("boom")
        return "applied", None, {}

    monkeypatch.setitem(apply_mod.HANDLERS, "chore.complete", flaky)
    a, b = cc("a", kid.id, run_today.chore_id), cc("b", kid.id, run_today.chore_id)
    rs = apply_actions(db, install, [a, b])
    assert [(r.result, r.reason) for r in rs] == [("rejected", "internal error"), ("applied", None)]
    row = db.query(IntegrationAction).filter_by(idempotency_key="a").one()
    assert (row.kid_id, row.chore_id) == (kid.id, run_today.chore_id)
    assert balance(db, kid.id) == 0


def test_failed_action_keeps_callers_pending_work(db, install, kid, run_today, monkeypatch):
    install.trusted = True  # caller's uncommitted change

    def boom(*_):
        raise HTTPException(409, "no")

    monkeypatch.setitem(apply_mod.HANDLERS, "chore.complete", boom)
    apply_actions(db, install, [cc("a", kid.id, run_today.chore_id)])
    db.expire_all()
    assert install.trusted is True


def test_unlinked_chore_rejected_and_audited(db, install, parent, kid, run_today):
    other, _ = make_chore(db, parent, kids=[kid])
    [r] = apply_actions(db, install, [cc("k1", kid.id, other.id)])
    assert (r.result, r.reason) == ("rejected", "chore not linked")
    assert run_today.status == "todo" and balance(db, kid.id) == 0
    row = db.query(IntegrationAction).one()
    assert (row.result, row.kid_id, row.chore_id) == ("rejected", kid.id, other.id)


def test_rejected_refs_skip_missing_rows(db, install, kid):
    [r] = apply_actions(db, install, [cc("k1", 99999, 88888)])
    assert r.result == "rejected"
    row = db.query(IntegrationAction).one()
    assert (row.kid_id, row.chore_id) == (None, None)
