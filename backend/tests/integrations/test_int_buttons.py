import time

import pytest
from app.integrations import health, widget_service
from app.models.integration import IntegrationAction
from tests.integrations.int_helpers import W, button, card, cc, msg, press_url, ru


@pytest.fixture(autouse=True)
def shown(db, widget_install, svc):
    """Parent widget w1 with button done -> chore.complete, shown (cached) on the parent surface."""
    svc.widgets = [W("w1", card(button("done", "chore.complete")))]
    widget_service.get(db, widget_install, "parent", None, time.time())
    db.commit()


def _press(client, headers, install, widget_id="w1", button_id="done", **extra):
    body = {"widget_id": widget_id, "button_id": button_id, **extra}
    return client.post(press_url(install), headers=headers, json=body)


def _audit(db, install):
    db.expire_all()
    return db.query(IntegrationAction).filter_by(install_id=install.id).all()


def test_kid_press_completion_always_waits(
    client, kid_headers, kid_widget_install, svc, kid, run_today
):
    kid_widget_install.trusted = True
    svc.press_reply = [cc("p1", kid.id, run_today.chore_id)]
    [r] = client.post(
        press_url(kid_widget_install),
        headers=kid_headers,
        json={"widget_id": "kid_w", "button_id": "done"},
    ).json()
    assert r["result"] == "pending" and svc.last_body["events"][0]["by"] == "kid"


def test_kid_press_cannot_act_for_sibling(
    client, kid_headers, kid_widget_install, svc, other_kid, run_other
):
    svc.press_reply = [cc("p1", other_kid.id, run_other.chore_id)]
    [r] = client.post(
        press_url(kid_widget_install),
        headers=kid_headers,
        json={"widget_id": "kid_w", "button_id": "done"},
    ).json()
    assert r["result"] == "rejected"


def test_reply_action_must_match_button(client, parent_headers, widget_install, svc):
    svc.press_reply = [msg("m1")]  # button action is chore.complete
    [r] = client.post(
        press_url(widget_install),
        headers=parent_headers,
        json={"widget_id": "w1", "button_id": "done"},
    ).json()
    assert r["reason"] == "not this button's action"


def test_parent_press_with_kid_id_finds_button(client, parent_headers, widget_install, svc, kid):
    r = client.post(
        press_url(widget_install),
        headers=parent_headers,
        json={"widget_id": "w1", "button_id": "done", "kid_id": kid.id},
    )
    assert r.status_code == 200 and svc.last_body["events"][0]["kid_id"] == kid.id


def test_unknown_button_404(client, parent_headers, widget_install):
    assert (
        client.post(
            press_url(widget_install),
            headers=parent_headers,
            json={"widget_id": "w1", "button_id": "nope"},
        ).status_code
        == 404
    )


def test_event_sent_and_parent_completion(
    client, db, parent_headers, widget_install, svc, kid, run_today
):
    svc.press_reply = [cc("p1", kid.id, run_today.chore_id)]
    r = _press(client, parent_headers, widget_install)
    assert r.json() == [{"result": "pending", "reason": None}]  # not trusted
    assert svc.last_path == "/v1/events"
    assert svc.last_body["events"] == [
        {"kind": "widget.pressed", "widget_id": "w1", "button_id": "done", "by": "parent",
         "kid_id": None}
    ]  # fmt: skip
    [row] = _audit(db, widget_install)
    assert (row.kind, row.result, row.idempotency_key) == ("chore.complete", "pending", "p1")


def test_trusted_parent_press_applies(
    client, db, parent_headers, widget_install, svc, kid, run_today
):
    widget_install.trusted = True
    db.commit()
    svc.press_reply = [cc("p1", kid.id, run_today.chore_id)]
    assert _press(client, parent_headers, widget_install).json()[0]["result"] == "applied"


def test_mismatched_actions_audited_in_order(
    client, db, parent_headers, widget_install, svc, kid, run_today
):
    widget_install.trusted = True
    db.commit()
    svc.press_reply = [ru("r1"), cc("p1", kid.id, run_today.chore_id), {"type": "junk"}]
    out = _press(client, parent_headers, widget_install).json()
    assert [r["result"] for r in out] == ["rejected", "applied", "rejected"]
    assert out[0]["reason"] == out[2]["reason"] == "not this button's action"
    rows = {r.kind: r for r in _audit(db, widget_install)}
    assert rows["reward.upsert"].reason == "not this button's action"
    assert rows["junk"].idempotency_key.startswith("invalid:")


def test_mismatched_duplicate_key_returns_prior(client, db, parent_headers, widget_install, svc):
    svc.press_reply = [msg("m1")]
    _press(client, parent_headers, widget_install)
    widget_service.get(db, widget_install, "parent", None, time.time())  # press cleared it
    db.commit()
    [r] = _press(client, parent_headers, widget_install).json()
    assert r["reason"] == "not this button's action" and len(_audit(db, widget_install)) == 1


def test_kid_button_can_never_go_beyond_asking(
    client, db, kid_headers, kid_widget_install, svc, kid
):
    """Even if a kid cache entry somehow held a reward button, the kid origin still refuses."""
    kid_widget_install.permissions = '["widgets.kid", "rewards.manage"]'
    db.commit()
    entry = (time.time() + 60, [W("kid_w", card(button("x", "reward.upsert")))], set())
    widget_service._cache[(kid_widget_install.id, "kid", kid.id)] = entry
    svc.press_reply = [ru("r1")]
    [r] = _press(client, kid_headers, kid_widget_install, "kid_w", "x").json()
    assert (r["result"], r["reason"]) == ("rejected", "kids can only ask")


def test_origins_passed_to_apply(
    client, db, parent_headers, kid_headers, kid_widget_install, svc, kid, run_today, monkeypatch
):
    from app.api import integration_widgets

    seen = []

    def spy(*a, **k):
        seen.append(k)
        return []

    monkeypatch.setattr(integration_widgets, "apply_actions", spy)
    svc.press_reply = [cc("p1", kid.id, run_today.chore_id)]
    _press(client, kid_headers, kid_widget_install, "kid_w", "done")
    svc.widgets = [W("w1", card(button("done", "chore.complete")))]
    widget_service.get(db, kid_widget_install, "parent", None, time.time())
    db.commit()
    _press(client, parent_headers, kid_widget_install, kid_id=kid.id)
    assert seen == [
        {"origin": "kid_button", "actor_kid_id": kid.id},
        {"origin": "parent_button", "actor_kid_id": None},
    ]


def test_kid_ignores_body_kid_id(client, kid_headers, kid_widget_install, svc, kid, other_kid):
    r = _press(client, kid_headers, kid_widget_install, "kid_w", "done", kid_id=other_kid.id)
    assert r.status_code == 200 and svc.last_body["events"][0]["kid_id"] == kid.id


def test_kid_cannot_press_parent_widget(client, kid_headers, kid_widget_install):
    assert _press(client, kid_headers, kid_widget_install, "w1", "done").status_code == 404


def test_kid_cannot_press_sibling_kid_widget(
    client, db, other_kid_headers, kid_widget_install, run_other, other_kid
):
    """other_kid is linked with kid widgets on, but kid_w was shown only to kid."""
    from app.models.integration import IntegrationKid

    db.query(IntegrationKid).filter_by(kid_id=other_kid.id).update({"kid_widgets": True})
    db.commit()
    r = _press(client, other_kid_headers, kid_widget_install, "kid_w", "done")
    assert r.status_code == 404


def test_kid_without_kid_widgets_404(client, db, kid_headers, kid_widget_install, kid):
    from app.models.integration import IntegrationKid

    db.query(IntegrationKid).filter_by(kid_id=kid.id).update({"kid_widgets": False})
    db.commit()
    assert _press(client, kid_headers, kid_widget_install, "kid_w", "done").status_code == 404


def test_parent_unlinked_kid_id_refused(client, parent_headers, widget_install, svc, other_kid):
    calls = svc.calls
    r = _press(client, parent_headers, widget_install, kid_id=other_kid.id)
    assert r.status_code == 422 and svc.calls == calls


@pytest.mark.parametrize("status", ["paused", "revoked"])
def test_inactive_install_404(client, db, parent_headers, widget_install, status):
    widget_install.status = status
    db.commit()
    r = _press(client, parent_headers, widget_install)
    assert r.status_code == 404 and r.json()["detail"] == "That button is gone."


def test_unknown_install_404(client, parent_headers, widget_install):
    assert _press(client, parent_headers, type("I", (), {"id": 99999})).status_code == 404


def test_service_down_502(client, db, parent_headers, widget_install, svc):
    svc.fail()
    r = _press(client, parent_headers, widget_install)
    assert r.status_code == 502 and r.json()["detail"] == "Demo didn't answer."
    db.expire_all()
    assert widget_install.failures == 1  # health counted and committed


def test_rate_limited_502(client, parent_headers, widget_install, svc, monkeypatch):
    monkeypatch.setattr(health, "OUTBOUND_PER_MIN", 1)  # the cache fill used it
    calls = svc.calls
    r = _press(client, parent_headers, widget_install)
    assert r.status_code == 502 and r.json()["detail"] == "Demo didn't answer."
    assert svc.calls == calls


def test_press_clears_widget_cache(client, parent_headers, widget_install):
    assert _press(client, parent_headers, widget_install).status_code == 200
    assert widget_service.button(widget_install.id, "parent", None, "w1", "done") is None


def test_needs_auth(client, widget_install):
    assert _press(client, {}, widget_install).status_code == 401
