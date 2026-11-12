"""Devices: ignored status, bulk update, gateway/box always hidden."""

from datetime import UTC, datetime

from app.lock.rules import block_reason
from app.lock.state import device_facts
from app.models.family import get_family
from app.models.lock import Device


def _dev(db, n, **kw):
    d = Device(mac=f"aa:bb:cc:dd:ee:{n:02x}", name=f"D{n}", status="unassigned", **kw)
    db.add(d)
    db.commit()
    return d


def test_list_hides_gateway_and_box_outside_setup(client, db, parent_headers):
    assert get_family(db).setup_step is None
    _dev(db, 1)
    _dev(db, 2, is_gateway=True)
    _dev(db, 3, is_box=True)
    got = client.get("/api/v1/devices", headers=parent_headers).json()
    assert [d["mac"] for d in got] == ["aa:bb:cc:dd:ee:01"]


def test_patch_accepts_ignored(client, db, parent_headers):
    d = _dev(db, 1)
    r = client.patch(f"/api/v1/devices/{d.id}", json={"status": "ignored"}, headers=parent_headers)
    assert r.status_code == 200 and r.json()["status"] == "ignored"


def test_ignored_follows_new_device_policy_and_not_unknown(client, db, parent_headers):
    d = _dev(db, 1)
    d.status = "ignored"
    fam = get_family(db)
    fam.new_devices_blocked = True
    db.commit()
    now = datetime.now(UTC)
    assert block_reason(device_facts(db, d, fam, now), now) == "new_device"
    fam.new_devices_blocked = False
    db.commit()
    assert block_reason(device_facts(db, d, fam, now), now) is None
    unknown = client.get("/api/v1/today", headers=parent_headers)
    assert all(x["id"] != d.id for x in unknown.json().get("new_devices", []))


def test_bulk_sets_status_and_owners(client, db, parent_headers, kid):
    a, b = _dev(db, 1), _dev(db, 2)
    r = client.post(
        "/api/v1/devices/bulk",
        json={"ids": [a.id, b.id], "status": "assigned", "owner_ids": [kid.id]},
        headers=parent_headers,
    )
    assert r.status_code == 200
    assert {d["status"] for d in r.json()} == {"assigned"}
    assert all(d["owner_ids"] == [kid.id] for d in r.json())


def test_bulk_ignored_and_guest_clear_owners(client, db, parent_headers, kid):
    a = _dev(db, 1)
    client.post(
        "/api/v1/devices/bulk",
        json={"ids": [a.id], "status": "assigned", "owner_ids": [kid.id]},
        headers=parent_headers,
    )
    for st in ("ignored", "guest", "unassigned"):
        r = client.post(
            "/api/v1/devices/bulk", json={"ids": [a.id], "status": st}, headers=parent_headers
        )
        assert r.status_code == 200
        assert r.json()[0]["status"] == st and r.json()[0]["owner_ids"] == []


def test_bulk_validates(client, db, parent_headers, kid):
    a = _dev(db, 1)
    h = parent_headers
    post = lambda body: client.post("/api/v1/devices/bulk", json=body, headers=h)  # noqa: E731
    assert post({"ids": [a.id, 999], "status": "guest"}).status_code == 400
    assert post({"ids": [], "status": "guest"}).status_code == 422
    assert post({"ids": [a.id], "status": "bogus"}).status_code == 422
    assert post({"ids": [a.id], "status": "assigned", "owner_ids": [999]}).status_code == 400
    assert post({"ids": [a.id], "status": "assigned"}).status_code == 400  # needs a kid
    db.refresh(a)
    assert a.status == "unassigned"


def test_bulk_requires_parent(client, db, kid_headers):
    body = {"ids": [1], "status": "guest"}
    r = client.post("/api/v1/devices/bulk", json=body, headers=kid_headers)
    assert r.status_code == 403


def test_list_carries_network_id(client, db, parent_headers):
    from app.models.network import Network

    n = Network(iface="eth1", subnet="10.0.0.0/24", auto_label="Guest")
    db.add(n)
    db.commit()
    _dev(db, 1, network_id=n.id)
    _dev(db, 2)
    got = {d["mac"]: d["network_id"] for d in client.get("/api/v1/devices", headers=parent_headers).json()}
    assert got == {"aa:bb:cc:dd:ee:01": n.id, "aa:bb:cc:dd:ee:02": None}
