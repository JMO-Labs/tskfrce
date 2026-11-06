from datetime import UTC, datetime, timedelta

from app.integrations.apply import apply_actions
from app.services import chore_actions
from tests.integrations.int_helpers import bell_item, cc


def _item(client, headers, run):
    items = client.get("/api/v1/today", headers=headers).json()["needs_you"]
    [it] = [i for i in items if i["id"] == run.id]
    return it


def test_pending_completion_is_integration_item(
    client, parent_headers, db, install, kid, run_today
):
    apply_actions(db, install, [cc("k1", kid.id, run_today.chore_id)])
    it = _item(client, parent_headers, run_today)
    assert it["type"] == "integration"
    assert it["integration"] == {"id": install.id, "name": "Demo", "icon": "extension"}


def test_kid_resubmit_after_send_back_is_plain_chore(
    client, parent_headers, db, install, kid, run_today
):
    apply_actions(db, install, [cc("k1", kid.id, run_today.chore_id)])
    chore_actions.send_back(db, run_today, "redo")
    db.commit()
    chore_actions.submit(
        run_today, kid.id, datetime.now(UTC).replace(tzinfo=None) + timedelta(seconds=1)
    )
    db.commit()
    assert _item(client, parent_headers, run_today)["type"] == "redo"


def test_bell_item_pending_until_decided(client, parent_headers, db, install, kid, run_today):
    apply_actions(db, install, [cc("k1", kid.id, run_today.chore_id)])
    assert bell_item(client, parent_headers, kind="integration_done")["pending"] is True
    client.post(f"/api/v1/chores/{run_today.id}/approve", headers=parent_headers)
    assert bell_item(client, parent_headers, kind="integration_done")["pending"] is False
