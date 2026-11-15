"""Auto names track the current signals; a parent-edited name is never overwritten."""

from app.core.config import settings
from app.models.lock import Device

H = {"X-Internal-Token": settings.INTERNAL_TOKEN}


def _seen(client, **kw):
    body = {"mac": "aa:bb:cc:00:00:01", "ip": "192.168.1.83", **kw}
    return client.post("/api/v1/internal/devices/seen", json=body, headers=H)


def _dev(db):
    db.expire_all()
    return db.query(Device).one()


def test_auto_name_refreshes_from_hostname(client, db, monkeypatch):
    _seen(client, hostname="old.maas")
    assert _dev(db).name == "old.maas"
    _seen(client, hostname="homeassistant.maas")
    d = _dev(db)
    assert d.name == "homeassistant.maas"
    assert d.name_from_parent is False


def test_ip_like_hostname_not_used_on_create_or_refresh(client, db):
    _seen(client, hostname="192-168-1-242.maas", vendor="Acme")
    assert _dev(db).name == "Acme device"
    _seen(client, hostname="192-168-1-241.maas", vendor="Acme")
    assert _dev(db).name == "Acme device"


def test_parent_edit_is_kept(client, db, parent_headers):
    _seen(client, hostname="old.maas")
    did = _dev(db).id
    r = client.patch(
        f"/api/v1/devices/{did}", json={"name": "Mia's laptop"}, headers=parent_headers
    )
    assert r.status_code == 200
    assert _dev(db).name_from_parent is True
    _seen(client, hostname="new.maas", mdns_name="x.local")
    assert _dev(db).name == "Mia's laptop"


def test_fingerprint_guess_ranks_below_hostname_above_vendor():
    from app.lock.device_names import display_device_name

    fp = "1,121,3,6,15,119,252,95"
    assert display_device_name(None, "kids-pc", fp, "Apple") == ("kids-pc", "hostname")
    assert display_device_name(None, None, fp, "Apple") == ("iPhone", "fingerprint")


def test_usable_name_rejects_machine_ids():
    from app.lock.device_names import display_device_name, usable_name

    assert usable_name("e097b8cf9b6e41bdbb64bf205dd82f7c") is None
    assert usable_name("e097b8cf-9b6e-41bd-bb64-bf205dd82f7c") is None
    assert usable_name("deadbeef") is None
    assert usable_name("12345") is None
    assert usable_name("homeassistant") == "homeassistant"
    assert usable_name("homeassistant.maas") == "homeassistant.maas"
    assert display_device_name(
        "e097b8cf9b6e41bdbb64bf205dd82f7c", "homeassistant.maas", None, None
    ) == ("homeassistant.maas", "hostname")
