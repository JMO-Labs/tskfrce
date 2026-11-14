from datetime import UTC, datetime, timedelta

from app.models.inbox import Notification
from app.models.lock import Device, DeviceHintRejection

URL = "/api/v1/internal/devices/seen"
OLD_MAC = "86:ff:8e:8e:6c:df"
NEW_MAC = "16:e2:a7:7b:cc:06"


def _now():
    return datetime.now(UTC).replace(tzinfo=None)


def tok():
    from app.core.config import settings

    return {"X-Internal-Token": settings.INTERNAL_TOKEN}


def _old(db, kid, mac=OLD_MAC, silent=timedelta(minutes=5), **kw):
    d = Device(
        mac=mac, name="Timmy's phone", status="assigned",
        first_seen=_now() - timedelta(days=3), last_seen=_now() - silent, **kw,
    )  # fmt: skip
    d.owners = [kid]
    db.add(d)
    db.commit()
    return d


def seen(client, mac=NEW_MAC, **kw):
    r = client.post(
        URL, json={"mac": mac, "ip": "10.0.0.9", "hostname": "phone", **kw}, headers=tok()
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


def test_relink_within_window(client, db, parent, kid):
    old = _old(db, kid)
    did = seen(client)
    db.expire_all()
    d = db.get(Device, did)
    assert d.status == "assigned" and d.owners == [kid]
    assert (d.hint_of_id, d.hint_reason) == (old.id, "relink")
    assert db.get(Device, old.id).replaced is True
    n = db.query(Notification).filter_by(kind="device_hint").one()
    assert n.user_id == parent.id and n.device_id == did
    assert n.title == "Timmy's phone reconnected with a new address"
    assert not db.query(Notification).filter_by(kind="new_device").count()


def test_no_relink_outside_window(client, db, kid):
    old = _old(db, kid, silent=timedelta(minutes=11))
    did = seen(client)
    db.expire_all()
    assert db.get(Device, did).status == "unassigned"
    assert db.get(Device, old.id).replaced is False


def test_no_relink_for_non_private_mac(client, db, kid):
    _old(db, kid)
    did = seen(client, mac="10:e2:a7:7b:cc:06")
    db.expire_all()
    assert db.get(Device, did).status == "unassigned"


def test_no_relink_when_old_mac_not_private(client, db, kid):
    _old(db, kid, mac="00:ff:8e:8e:6c:df")
    assert db.get(Device, seen(client)).status == "unassigned"


def test_no_relink_across_networks(client, db, kid):
    _old(db, kid, vlan_id=10)
    did = seen(client, vid=20)
    db.expire_all()
    assert db.get(Device, did).status == "unassigned"


def test_no_relink_on_fingerprint_conflict(client, db, kid):
    _old(db, kid, dhcp_fp="1,3,6")
    did = seen(client, dhcp_fp="1,15,3")
    db.expire_all()
    assert db.get(Device, did).status == "unassigned"


def test_undo_restores(client, db, parent_headers, kid):
    old = _old(db, kid)
    did = seen(client)
    r = client.post(f"/api/v1/devices/{did}/hint/undo", headers=parent_headers)
    assert r.status_code == 200 and r.json()["status"] == "unassigned"
    db.expire_all()
    assert db.get(Device, old.id).replaced is False
    assert db.get(DeviceHintRejection, (did, old.id)) is not None


def test_replaced_hidden_from_list(client, db, parent_headers, kid):
    old = _old(db, kid)
    did = seen(client)
    ids = [d["id"] for d in client.get("/api/v1/devices", headers=parent_headers).json()]
    assert did in ids and old.id not in ids


def _status(db, did):
    db.expire_all()
    return db.get(Device, did).status


def test_online_candidate_never_relinked(client, db, kid):
    old = _old(db, kid, silent=timedelta(seconds=3))
    assert _status(db, seen(client)) == "unassigned"
    assert db.get(Device, old.id).replaced is False


def test_two_same_owner_candidates_no_relink(client, db, kid):
    _old(db, kid, silent=timedelta(minutes=5))
    laptop = _old(db, kid, mac="9a:ff:8e:8e:6c:01", silent=timedelta(seconds=2))
    did = seen(client)
    assert _status(db, did) == "unassigned"
    assert db.get(Device, laptop.id).replaced is False


def test_two_silent_same_owner_candidates_no_relink(client, db, kid):
    a = _old(db, kid, silent=timedelta(minutes=5))
    b = _old(db, kid, mac="9a:ff:8e:8e:6c:01", silent=timedelta(minutes=3))
    assert _status(db, seen(client)) == "unassigned"
    assert not db.get(Device, a.id).replaced and not db.get(Device, b.id).replaced


def test_two_owners_no_relink(client, db, kid, parent):
    _old(db, kid, silent=timedelta(minutes=5))
    other = _old(db, parent, mac="9a:ff:8e:8e:6c:01", silent=timedelta(seconds=2))
    assert _status(db, seen(client)) == "unassigned"
    assert db.get(Device, other.id).replaced is False


def test_guest_join_while_phone_online(client, db, kid):
    phone = _old(db, kid, silent=timedelta(seconds=5))
    assert _status(db, seen(client)) == "unassigned"
    assert db.get(Device, phone.id).replaced is False


def test_relinked_device_is_not_a_source_for_chain(client, db, kid):
    _old(db, kid)
    first = seen(client)
    db.get(Device, first).last_seen = _now() - timedelta(minutes=2)
    db.commit()
    second = seen(client, mac="22:e2:a7:7b:cc:07")
    assert _status(db, first) == "assigned"
    assert _status(db, second) == "unassigned"
    assert db.get(Device, first).replaced is False


def test_replaced_device_reappearing_undoes_relink(client, db, parent, kid):
    old = _old(db, kid)
    did = seen(client)
    assert _status(db, did) == "assigned"
    seen(client, mac=OLD_MAC)
    db.expire_all()
    new, old_row = db.get(Device, did), db.get(Device, old.id)
    assert old_row.replaced is False
    assert new.status == "unassigned" and new.owners == [] and new.hint_of_id is None
    assert db.get(DeviceHintRejection, (did, old.id)) is not None
    titles = [n.title for n in db.query(Notification).filter_by(kind="device_hint")]
    assert any("came back" in t for t in titles)
