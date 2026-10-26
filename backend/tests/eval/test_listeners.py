from datetime import date

import pytest
from app.core.config import settings
from app.eval import listeners, store
from app.models.chores import ChoreRun
from app.models.family import get_family
from app.models.lock import Device, TimeWindow
from app.models.user import UserRole

from tests.conftest import _headers, _make_user
from tests.factories import api_chore, make_run

DAY = date(2026, 10, 20)


@pytest.fixture(autouse=True)
def _listen(db):
    listeners.register()
    get_family(db).last_reset_date = DAY
    db.commit()


def _umami(name):
    return [r.body["payload"] for r in store.due(1e12, 100) if r.body["payload"]["name"] == name]


def _count(name):
    return store.counters(store.local_day()).get(name, 0)


def test_run_counters(client, db, eval_on, parent_headers, kid, kid_headers):
    store.set_kid_age(kid.id, "8–10")
    api_chore(client, parent_headers, [kid])
    api_chore(client, parent_headers, [kid], title="Bins")
    assert _count("chores_assigned") == 2
    first, second = db.query(ChoreRun).order_by(ChoreRun.id).all()
    assert client.post(f"/api/v1/kid/chores/{first.id}/done", headers=kid_headers).is_success
    assert _count("chores_done") == 1
    [ev] = _umami("chore_done")
    assert (ev["url"], ev["data"]["source"], ev["data"]["age_group"]) == ("/kid", "kid", "8–10")
    assert client.post(f"/api/v1/chores/{first.id}/approve", headers=parent_headers).is_success
    assert _count("chores_approved") == 1
    assert client.post(f"/api/v1/chores/{second.id}/skip", headers=parent_headers).is_success
    assert _count("chores_skipped") == 1
    assert _umami("first_chore") == []  # wizard not done yet


def test_first_chore_once(client, db, eval_on, parent, parent_headers, kid):
    store.kv_set("wizard_done_at", "0")
    runs = [make_run(db, parent, kid, status="submitted", title=t) for t in ("a", "b")]
    for r in runs:
        assert client.post(f"/api/v1/chores/{r.id}/approve", headers=parent_headers).is_success
    [ev] = _umami("first_chore")
    assert isinstance(ev["data"]["minutes"], int)


def test_override_once_per_action(client, db, eval_on, parent_headers, kid):
    for i in range(3):
        d = Device(mac=f"aa:bb:cc:dd:ee:0{i}", name=f"D{i}", status="assigned")
        d.owners = [kid]
        db.add(d)
    db.commit()
    r = client.post(
        f"/api/v1/kids/{kid.id}/override",
        json={"action": "unlock", "minutes": 60},
        headers=parent_headers,
    )
    assert r.is_success
    assert _count("manual_unlocks") == 1
    assert _count("manual_locks") == 0
    [ev] = _umami("override")
    assert (ev["data"]["action"], ev["data"]["duration_bucket"]) == ("unlock", "2h")


def test_rule_off_kinds(client, db, eval_on, parent, parent_headers, kid):
    def kinds():
        return [e["data"]["kind"] for e in _umami("rule_off")]

    ws = [
        TimeWindow(kind=k, days="0123456", start="08:00", end="20:00", kid_id=kid.id)
        for k in ("allowed", "free")
    ]
    d = Device(mac="aa:bb:cc:dd:ee:01", name="Tab", status="assigned")
    db.add_all([*ws, d])
    db.commit()
    assert client.delete(f"/api/v1/windows/{ws[1].id}", headers=parent_headers).is_success
    assert kinds() == []
    assert client.delete(f"/api/v1/windows/{ws[0].id}", headers=parent_headers).is_success
    assert kinds() == ["hours"]
    r = client.patch(f"/api/v1/devices/{d.id}", json={"status": "guest"}, headers=parent_headers)
    assert r.is_success
    assert kinds() == ["hours", "chore_lock"]
    run = make_run(db, parent, kid)
    chore_id = run.assignment.chore_id
    assert client.delete(f"/api/v1/chores/{chore_id}", headers=parent_headers).is_success
    assert kinds() == ["hours", "chore_lock", "rule_deleted"]


def test_chore_note_event(client, db, eval_on, parent_headers):
    kid = _make_user(db, "leo", UserRole.KID)
    store.set_kid_age(kid.id, "11–13")
    api_chore(client, parent_headers, [kid])
    rid = db.query(ChoreRun).one().id
    r = client.post(
        f"/api/v1/kid/chores/{rid}/note",
        json={"label": "Need help", "text": "secret words"},
        headers=_headers(db, kid),
    )
    assert r.is_success
    [ev] = _umami("chore_note")
    assert ev["data"]["age_group"] == "11–13"
    assert "secret" not in str(ev) and "Need help" not in str(ev)


def test_listener_off(client, db, parent, parent_headers, kid, kid_headers, monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "DATA_DIR", tmp_path)
    api_chore(client, parent_headers, [kid])
    rid = db.query(ChoreRun).one().id
    client.post(f"/api/v1/kid/chores/{rid}/done", headers=kid_headers)
    client.post(f"/api/v1/chores/{rid}/approve", headers=parent_headers)
    d = Device(mac="aa:bb:cc:dd:ee:01", name="Tab", status="assigned", owners=[kid])
    db.add(d)
    db.commit()
    client.post(f"/api/v1/kids/{kid.id}/override", json={"action": "lock"}, headers=parent_headers)
    client.patch(f"/api/v1/devices/{d.id}", json={"status": "guest"}, headers=parent_headers)
    assert not (tmp_path / "eval.db").exists()
