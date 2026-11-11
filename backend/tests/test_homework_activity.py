"""Homework activity: blocker upload, parent view, 7-day retention."""

from datetime import UTC, datetime, timedelta

from app.core.config import settings
from app.lock.state import tick
from app.models.homework import HomeworkActivity
from app.models.lock import Device, Override

UP = "/api/v1/internal/homework/activity"
READ = "/api/v1/homework/activity"
START = "2026-11-04T15:00:00Z"


def tok():
    return {"X-Internal-Token": settings.INTERNAL_TOKEN}


def mk(db, kid=None, mac="aa:bb:cc:dd:ee:01", name="Tab"):
    d = Device(mac=mac, name=name, status="assigned")
    d.owners = [kid] if kid else []
    db.add(d)
    db.commit()
    return d


def item(domain, minutes=1, lookups=1, mac="AA:BB:CC:DD:EE:01", **kw):
    return {
        "mac": mac,
        "session_start": START,
        "domain": domain,
        "via": "list",
        "pulled_by": None,
        "first_seen": START,
        "last_seen": "2026-11-04T15:05:00Z",
        "lookups": lookups,
        "active_minutes": minutes,
        **kw,
    }


def up(client, items, headers=None):
    return client.post(UP, json={"items": items}, headers=tok() if headers is None else headers)


def test_upload_then_read_sorted(client, db, kid, parent_headers):
    d = mk(db, kid)
    r = up(
        client,
        [
            item("classroom.google.com", 3),
            item("fonts.example", 9, via="follow", pulled_by="classroom.google.com"),
        ],
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True, "stored": 2}
    [s] = client.get(f"{READ}?device_id={d.id}", headers=parent_headers).json()
    assert s["device_id"] == d.id and s["device_name"] == "Tab"
    assert s["kid_id"] == kid.id and s["session_start"] == START
    assert s["active"] is False and s["until"] is None
    assert [i["domain"] for i in s["items"]] == ["fonts.example", "classroom.google.com"]
    assert s["items"][0]["pulled_by"] == "classroom.google.com"
    assert s["items"][0]["via"] == "follow"


def test_second_upload_replaces_totals(client, db):
    mk(db)
    up(client, [item("a.example", 2, 5)])
    up(client, [item("a.example", 4, 7, last_seen="2026-11-04T15:01:00Z")])
    [row] = db.query(HomeworkActivity).all()
    assert (row.active_minutes, row.lookups) == (4, 7)
    assert row.last_seen == datetime(2026, 11, 4, 15, 5)  # max, not the older one


def test_unknown_mac_skipped(client, db):
    mk(db)
    r = up(client, [item("a.example"), item("b.example", mac="aa:bb:cc:dd:ee:99")])
    assert r.json()["stored"] == 1


def test_bad_token_403(client):
    assert up(client, [item("a.example")], headers={}).status_code == 403


def test_too_many_items_422(client):
    assert up(client, [item(f"x{i}.example") for i in range(501)]).status_code == 422


def test_bad_mac_422(client):
    assert up(client, [item("a.example", mac="nope")]).status_code == 422


def test_kid_filter_returns_all_kid_devices(client, db, kid, parent_headers):
    a = mk(db, kid)
    b = mk(db, kid, mac="aa:bb:cc:dd:ee:02", name="Phone")
    mk(db, mac="aa:bb:cc:dd:ee:03", name="Other")
    up(client, [item("a.example", mac=m) for m in ("aa:bb:cc:dd:ee:0" + n for n in "123")])
    out = client.get(f"{READ}?kid_id={kid.id}", headers=parent_headers).json()
    assert sorted(s["device_id"] for s in out) == [a.id, b.id]


def test_most_recent_session_and_active(client, db, kid, parent_headers):
    d = mk(db, kid)
    up(client, [item("old.example", session_start="2026-11-04T10:00:00Z"), item("new.example")])
    until = datetime.now(UTC).replace(tzinfo=None, microsecond=0) + timedelta(minutes=30)
    db.add(Override(device_id=d.id, action="homework", source="manual", expires_at=until))
    db.commit()
    [s] = client.get(f"{READ}?device_id={d.id}", headers=parent_headers).json()
    assert [i["domain"] for i in s["items"]] == ["new.example"]
    assert s["active"] is True
    assert s["until"] == until.isoformat() + "Z"


def test_kid_cannot_read(client, kid_headers):
    assert client.get(READ, headers=kid_headers).status_code == 403


def test_tick_purges_after_7_days(db):
    d = mk(db)
    now = datetime(2026, 11, 4, 12, 0)
    for days, dom in ((8, "old.example"), (6, "recent.example")):
        t = now - timedelta(days=days)
        db.add(
            HomeworkActivity(
                device_id=d.id,
                session_start=t,
                domain=dom,
                via="list",
                first_seen=t,
                last_seen=t,
                lookups=1,
                active_minutes=1,
            )
        )
    db.commit()
    tick(db, now.replace(tzinfo=UTC))
    assert [r.domain for r in db.query(HomeworkActivity)] == ["recent.example"]


def test_rows_capped_per_device_session(client, db, monkeypatch):
    from app.api import internal

    monkeypatch.setattr(internal, "HW_ACTIVITY_MAX_ROWS", 2)
    mk(db)
    assert up(client, [item("a.example"), item("b.example")]).json()["stored"] == 2
    r = up(client, [item("c.example"), item("a.example", 5, 9)])
    assert r.json()["stored"] == 1  # new name refused, known name still updated
    assert {x.domain for x in db.query(HomeworkActivity)} == {"a.example", "b.example"}
    other = item("d.example", session_start="2026-11-05T15:00:00Z")
    assert up(client, [other]).json()["stored"] == 1  # the cap is per session
