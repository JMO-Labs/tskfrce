import asyncio
import threading
import time

from app.core.config import settings
from app.lock import loop
from app.models.family import get_family
from app.models.lock import Device

BODY = {"mac": "AA:BB:CC:DD:EE:02", "ip": "10.0.0.5", "ipv6": [], "hostname": "pad", "vendor": "X"}
URL = "/api/v1/internal/devices/seen"


def tok():
    return {"X-Internal-Token": settings.INTERNAL_TOKEN}


def test_seen_without_token_403(client):
    assert client.post(URL, json=BODY).status_code == 403
    r = client.post(URL, json=BODY, headers={"X-Internal-Token": "nope"})
    assert r.status_code == 403


def test_seen_upserts_and_state_lists_blocked(client, db):
    get_family(db).new_devices_blocked = True  # opt out of learning mode
    db.commit()
    for _ in range(2):
        assert client.post(URL, json=BODY, headers=tok()).status_code == 200
    r = client.get("/api/v1/internal/state", headers=tok())
    assert r.json()["blocked"] == ["aa:bb:cc:dd:ee:02"]
    assert client.get("/api/v1/internal/state").status_code == 403


def test_seen_invalid_mac_422(client):
    r = client.post(URL, json={**BODY, "mac": "nonsense"}, headers=tok())
    assert r.status_code == 422


def test_seen_dash_mac_normalized(client, db):
    get_family(db).new_devices_blocked = True  # opt out of learning mode
    db.commit()
    client.post(URL, json={**BODY, "mac": "AA-BB-CC-DD-EE-09"}, headers=tok())
    r = client.get("/api/v1/internal/state", headers=tok())
    assert r.json()["blocked"] == ["aa:bb:cc:dd:ee:09"]


def test_report_does_not_overwrite_parent_name(client, db):
    client.post(URL, json=BODY, headers=tok())
    d = db.query(Device).one()
    d.name, d.name_from_parent = "Timmy's iPad", True
    db.commit()
    client.post(URL, json={**BODY, "hostname": "new"}, headers=tok())
    db.expire_all()
    assert db.query(Device).one().name == "Timmy's iPad"


def test_trigger_safe_without_loop():
    loop.trigger()


def test_trigger_wakes_running_loop_from_other_thread(monkeypatch):
    calls = []
    monkeypatch.setattr(loop, "_run_once", lambda: calls.append(time.monotonic()))
    monkeypatch.setattr(settings, "LOCK_INTERVAL_SECONDS", 30)

    async def go():
        t = asyncio.create_task(loop.run_forever())
        await asyncio.sleep(1.5)
        t.cancel()

    th = threading.Thread(target=lambda: asyncio.run(go()))
    th.start()
    time.sleep(0.5)
    loop.trigger()
    th.join()
    assert len(calls) == 2
    assert calls[1] - calls[0] < 5


def test_hostname_vendor_change_keeps_locked_device_blocked(client, db):
    """#109: a DHCP hostname/vendor/fingerprint change (#95 capture, #217/#218 relink) never
    drops a locked device from the blocker's targets, not even for one report."""
    get_family(db).new_devices_blocked = True
    db.commit()
    mac = "16:e2:a7:7b:cc:06"  # private (random) MAC: the relink path is eligible
    first = {**BODY, "mac": mac, "hostname": "pixel-7"}
    client.post(URL, json=first, headers=tok())
    assert client.get("/api/v1/internal/state", headers=tok()).json()["blocked"] == [mac]
    for extra in (
        {"hostname": None, "dhcp_hostname": "android-9f3a"},
        {"hostname": "other-name", "vendor": "Google"},
        {"dhcp_fp": "1,3,6,15,26,28,51,58,59,43", "mdns_name": "x.local", "model": "Pixel"},
    ):
        assert client.post(URL, json={**first, **extra}, headers=tok()).status_code == 200
        blocked = client.get("/api/v1/internal/state", headers=tok()).json()["blocked"]
        assert blocked == [mac]
    db.expire_all()
    d = db.query(Device).filter_by(mac=mac).one()
    assert not d.replaced and d.hint_of_id is None
