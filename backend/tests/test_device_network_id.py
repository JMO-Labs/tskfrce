"""devices.network_id is set from the seen iface/IP and keeps relink on one network."""

from app.models.lock import Device
from app.models.network import Network

from tests.test_device_relink import _old, seen, tok


def _nets(db):
    a = Network(iface="eno2", subnet="192.168.1.0/24", auto_label="Wired")
    b = Network(iface="wlo1", subnet="192.168.2.0/24", auto_label="WiFi")
    db.add_all([a, b])
    db.commit()
    return a.id, b.id


def test_seen_sets_network_from_iface(client, db):
    n1, n2 = _nets(db)
    did = seen(client, ip="192.168.2.5", iface="wlo1", mac="aa:00:00:00:00:01")
    db.expire_all()
    assert db.get(Device, did).network_id == n2


def test_seen_sets_network_from_cidr_without_iface(client, db):
    n1, _ = _nets(db)
    did = seen(client, ip="192.168.1.7", mac="aa:00:00:00:00:02")
    db.expire_all()
    assert db.get(Device, did).network_id == n1


def test_device_moving_networks_updates(client, db):
    n1, n2 = _nets(db)
    did = seen(client, ip="192.168.1.7", mac="aa:00:00:00:00:03")
    seen(client, ip="192.168.2.9", mac="aa:00:00:00:00:03")
    db.expire_all()
    assert db.get(Device, did).network_id == n2


def test_devices_api_returns_network_id(client, db, parent_headers):
    n1, n2 = _nets(db)
    a = seen(client, ip="192.168.1.7", mac="aa:00:00:00:00:04")
    b = seen(client, ip="192.168.2.7", mac="aa:00:00:00:00:05")
    got = {
        d["id"]: d["network_id"]
        for d in client.get("/api/v1/devices", headers=parent_headers).json()
    }
    assert (got[a], got[b]) == (n1, n2)


def test_networks_report_backfills_unset_devices(client, db):
    did = seen(client, ip="192.168.2.5", mac="aa:00:00:00:00:06")
    r = client.post(
        "/api/v1/internal/networks",
        json={"networks": [{"iface": "wlo1", "subnet": "192.168.2.0/24", "auto_label": "WiFi"}]},
        headers=tok(),
    )
    assert r.status_code == 200
    db.expire_all()
    assert db.get(Device, did).network_id == db.query(Network).one().id


def test_no_relink_across_network_ids(client, db, kid):
    n1, n2 = _nets(db)
    old = _old(db, kid, network_id=n1)
    did = seen(client, ip="192.168.2.9", iface="wlo1")
    db.expire_all()
    assert db.get(Device, did).status == "unassigned"
    assert db.get(Device, old.id).replaced is False


def test_relink_same_network_id(client, db, kid):
    n1, _ = _nets(db)
    _old(db, kid, network_id=n1)
    did = seen(client, ip="192.168.1.9", iface="eno2")
    db.expire_all()
    assert db.get(Device, did).status == "assigned"
