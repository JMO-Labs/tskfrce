"""Kid homework requests, parent approve/deny and the "Needs you" row."""

from app.models.homework import HomeworkRequest
from app.models.inbox import Notification
from app.models.lock import Device, Override

ASK = "/api/v1/kid/homework"


def mk(db, kid, mac="aa:bb:cc:dd:ee:01", locked=True):
    """Kid device: locked ones are paused, unlocked ones (no hour rules) online."""
    d = Device(mac=mac, name="Tab", status="assigned")
    d.owners = [kid]
    db.add(d)
    db.commit()
    if locked:
        db.add(Override(device_id=d.id, action="lock", source="manual"))
        db.commit()
    return d


def homework(db, d):
    return db.query(Override).filter_by(device_id=d.id, action="homework").all()


def ask(client, kid_headers):
    return client.post(ASK, headers=kid_headers)


def decide(client, h, rid, verb="approve", **body):
    return client.post(f"/api/v1/homework/requests/{rid}/{verb}", json=body or None, headers=h)


def test_paused_kid_asks_and_parent_is_notified(client, db, kid, parent, kid_headers):
    mk(db, kid)
    r = ask(client, kid_headers)
    assert r.status_code == 200, r.text
    assert r.json()["ok"] is True
    req = db.get(HomeworkRequest, r.json()["id"])
    assert req.kid_id == kid.id and req.status == "pending"
    [n] = db.query(Notification).filter_by(user_id=parent.id, kind="homework_request").all()
    assert n.title == "Homework time"
    assert n.body == "Timmy is asking for homework time"


def test_duplicate_is_409(client, db, kid, parent, kid_headers):
    mk(db, kid)
    ask(client, kid_headers)
    r = ask(client, kid_headers)
    assert r.status_code == 409
    assert r.json()["detail"] == "You already asked. A parent will answer soon."


def test_not_paused_is_409(client, db, kid, parent, kid_headers):
    mk(db, kid, locked=False)
    r = ask(client, kid_headers)
    assert r.status_code == 409
    assert r.json()["detail"] == "Your internet is already on."


def test_parent_cannot_ask(client, db, kid, parent_headers):
    mk(db, kid)
    assert client.post(ASK, headers=parent_headers).status_code == 403


def test_approve_turns_on_homework(client, db, kid, parent, kid_headers, parent_headers):
    d = mk(db, kid)
    online = mk(db, kid, mac="aa:bb:cc:dd:ee:02", locked=False)
    rid = ask(client, kid_headers).json()["id"]
    r = decide(client, parent_headers, rid, minutes=30)
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True, "devices": 1}
    assert len(homework(db, d)) == 1 and homework(db, online) == []
    req = db.get(HomeworkRequest, rid)
    assert (req.status, req.minutes, req.decided_by_id) == ("approved", 30, parent.id)
    assert db.query(Notification).filter_by(user_id=kid.id, kind="redemption_decided").count()


def test_approve_defaults_and_bounds(client, db, kid, parent, kid_headers, parent_headers):
    mk(db, kid)
    rid = ask(client, kid_headers).json()["id"]
    assert decide(client, parent_headers, rid, minutes=5).status_code == 422
    assert decide(client, parent_headers, rid).status_code == 200
    assert db.get(HomeworkRequest, rid).minutes == 60


def test_approve_with_nothing_paused(client, db, kid, parent, kid_headers, parent_headers):
    d = mk(db, kid)
    rid = ask(client, kid_headers).json()["id"]
    db.query(Override).filter_by(device_id=d.id).delete()  # back online meanwhile
    db.commit()
    r = decide(client, parent_headers, rid)
    assert r.json() == {"ok": True, "devices": 0}
    assert db.get(HomeworkRequest, rid).status == "approved"


def test_double_approve_is_409(client, db, kid, parent, kid_headers, parent_headers):
    mk(db, kid)
    rid = ask(client, kid_headers).json()["id"]
    decide(client, parent_headers, rid)
    r = decide(client, parent_headers, rid, "deny")
    assert r.status_code == 409
    assert r.json()["detail"] == "Someone already answered this request."


def test_deny(client, db, kid, parent, kid_headers, parent_headers):
    d = mk(db, kid)
    rid = ask(client, kid_headers).json()["id"]
    assert decide(client, parent_headers, rid, "deny").status_code == 200
    assert db.get(HomeworkRequest, rid).status == "denied"
    assert homework(db, d) == []
    assert db.query(Notification).filter_by(user_id=kid.id, kind="redemption_decided").count()


def test_unknown_request_404(client, parent_headers):
    assert decide(client, parent_headers, 999).status_code == 404


def test_needs_you_has_homework_item(client, db, kid, parent, kid_headers, parent_headers):
    mk(db, kid)
    rid = ask(client, kid_headers).json()["id"]
    needs = client.get("/api/v1/today", headers=parent_headers).json()["needs_you"]
    [item] = [i for i in needs if i["type"] == "homework"]
    assert item["id"] == rid and item["kid_id"] == kid.id and item["kid_name"] == "Timmy"
    assert item["title"] == "Homework time" and item["submitted_at"].endswith("Z")


def test_kid_today_pending_then_until(client, db, kid, parent, kid_headers, parent_headers):
    mk(db, kid)
    t = client.get("/api/v1/kid/today", headers=kid_headers).json()
    assert t["homework"] is None and t["homework_pending"] is False
    rid = ask(client, kid_headers).json()["id"]
    assert client.get("/api/v1/kid/today", headers=kid_headers).json()["homework_pending"]
    decide(client, parent_headers, rid)
    t = client.get("/api/v1/kid/today", headers=kid_headers).json()
    assert t["homework_pending"] is False
    assert t["homework"]["until"].endswith("Z")
