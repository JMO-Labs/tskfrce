"""Opt-in: new private-MAC devices start held until a parent acts (tskfrce#102)."""

import pytest
from app.core.config import settings
from app.models.family import get_family
from app.models.lock import Device
from app.services.suggestions.engine import suggestions

URL = "/api/v1/internal/devices/seen"
PRIVATE = "fa:bb:cc:dd:ee:02"  # locally administered bit set
HARDWARE = "a8:bb:cc:dd:ee:03"


def tok():
    return {"X-Internal-Token": settings.INTERNAL_TOKEN}


def seen(client, mac, **kw):
    body = {"mac": mac, "ip": "10.0.0.5", "ipv6": [], "hostname": "pad", "vendor": "X", **kw}
    assert client.post(URL, json=body, headers=tok()).status_code == 200


def blocked(client):
    return client.get("/api/v1/internal/state", headers=tok()).json()["blocked"]


@pytest.fixture
def on(db):
    get_family(db).hold_private_devices = True
    db.commit()


def test_setting_defaults_off(db):
    assert get_family(db).hold_private_devices is False


def test_private_new_device_is_held(client, db, on):
    seen(client, PRIVATE)
    assert blocked(client) == [PRIVATE]
    assert db.query(Device).one().held is True


def test_hardware_device_not_held(client, db, on):
    seen(client, HARDWARE)
    assert blocked(client) == []
    assert db.query(Device).one().held is False


def test_setting_off_never_holds(client, db):
    seen(client, PRIVATE)
    assert blocked(client) == []


def test_parent_notified_when_held(client, db, on, parent):
    from app.models.inbox import Notification

    seen(client, PRIVATE)
    assert any("held" in n.title.lower() for n in db.query(Notification))


def test_allow_lifts_hold(client, db, on, parent_headers):
    seen(client, PRIVATE)
    d = db.query(Device).one()
    r = client.patch(f"/api/v1/devices/{d.id}", json={"held": False}, headers=parent_headers)
    assert r.status_code == 200 and r.json()["held"] is False
    assert blocked(client) == []


def test_assign_lifts_hold(client, db, on, parent_headers, kid):
    seen(client, PRIVATE)
    d = db.query(Device).one()
    r = client.patch(
        f"/api/v1/devices/{d.id}", json={"owner_ids": [kid.id]}, headers=parent_headers
    )
    assert r.json()["held"] is False


def test_device_out_reports_held(client, db, on, parent_headers):
    seen(client, PRIVATE)
    out = client.get("/api/v1/devices", headers=parent_headers).json()
    assert out[0]["held"] is True and out[0]["reason"] == "new_device"


def test_family_patch_roundtrip(client, db, parent_headers):
    r = client.patch("/api/v1/family", json={"hold_private_devices": True}, headers=parent_headers)
    assert r.json()["hold_private_devices"] is True


def _ambiguous(client, db, kid_ids=2):
    from datetime import datetime, timedelta

    now = datetime.utcnow()
    for i in range(2):
        db.add(
            Device(
                mac=f"fa:00:00:00:00:0{i}",
                name=f"p{i}",
                status="assigned",
                last_seen=now - timedelta(minutes=3),
                first_seen=now - timedelta(days=1),
            )
        )
    db.commit()
    seen(client, "fe:00:00:00:00:99")


def test_ambiguous_relink_suggests_setting_once_off(client, db):
    _ambiguous(client, db)
    items = suggestions(db)["items"]
    assert [s["rule"] for s in items if s["rule"] == "devices.hold_private"]


def test_suggestion_stays_gone_once_dismissed(client, db, parent_headers):
    _ambiguous(client, db)
    s = next(i for i in suggestions(db)["items"] if i["rule"] == "devices.hold_private")
    r = client.post(
        "/api/v1/suggestions/dismiss",
        json={"key": s["key"], "fingerprint": s["fingerprint"]},
        headers=parent_headers,
    )
    assert r.status_code == 200
    seen(client, "fe:00:00:00:00:98")  # another ambiguous relink does not bring it back
    r = client.get("/api/v1/suggestions", headers=parent_headers)
    assert "devices.hold_private" not in [i["rule"] for i in r.json()["items"]]


def _kid_device(db, kid, mac="aa:00:00:00:00:01", silent=3, **kw):
    from datetime import datetime, timedelta

    d = Device(
        mac=mac, name="Timmy's iPad", status="assigned", mdns_name="Bobbys-iPad",
        first_seen=datetime.utcnow() - timedelta(days=9),
        last_seen=datetime.utcnow() - timedelta(minutes=silent), **kw,
    )  # fmt: skip
    d.owners = [kid]
    db.add(d)
    db.commit()
    return d


def test_hinted_private_device_is_held_not_opened(client, db, on, kid):
    _kid_device(db, kid, silent=120)  # outside the relink window: only the hint applies
    seen(client, PRIVATE, mdns_name="bobbys-ipad")
    d = db.query(Device).filter_by(mac=PRIVATE).one()
    assert d.held is True and d.hint_of_id is None
    assert PRIVATE in blocked(client)


def test_single_candidate_relink_unaffected_by_setting(client, db, on, kid):
    old = _kid_device(db, kid, mac="fa:00:00:00:00:07")
    seen(client, PRIVATE)
    d = db.query(Device).filter_by(mac=PRIVATE).one()
    assert d.held is False and d.status == "assigned" and d.owners == [kid]
    assert d.hint_of_id == old.id and PRIVATE not in blocked(client)


def test_relink_of_paused_device_stays_paused(client, db, on, kid):
    from datetime import datetime

    from app.models.lock import Override

    old = _kid_device(db, kid, mac="fa:00:00:00:00:07")
    db.add(Override(device_id=old.id, action="lock", source="manual", created_at=datetime.utcnow()))
    db.commit()
    seen(client, PRIVATE)
    d = db.query(Device).filter_by(mac=PRIVATE).one()
    assert d.hint_of_id == old.id and d.held is False
    assert PRIVATE in blocked(client)


def test_no_suggestion_when_on(client, db, on):
    _ambiguous(client, db)
    assert not [s for s in suggestions(db)["items"] if s["rule"] == "devices.hold_private"]


def post_seen(client, mac, **kw):
    body = {"mac": mac, "ip": "10.0.0.5", "ipv6": [], "hostname": "pad", "vendor": "X", **kw}
    return client.post(URL, json=body, headers=tok()).json()


def test_seen_answers_blocked_for_held_device(client, on):
    assert post_seen(client, PRIVATE)["blocked"] is True


def test_seen_answers_open_for_default_family(client):
    assert post_seen(client, PRIVATE)["blocked"] is False


def test_seen_answers_blocked_when_new_devices_blocked(client, db):
    get_family(db).new_devices_blocked = True
    db.commit()
    assert post_seen(client, HARDWARE)["blocked"] is True


def test_state_tells_blocker_to_fail_closed_only_when_configured(client, db):
    def flag():
        return client.get("/api/v1/internal/state", headers=tok()).json()["block_unknown"]

    assert flag() is False
    get_family(db).hold_private_devices = True
    db.commit()
    assert flag() is True
