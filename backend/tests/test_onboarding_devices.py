"""Setup device discovery: filtering, naming, rescan."""

import pytest
from datetime import UTC, datetime, timedelta

from app.api.devices import _setup_devices
from app.lock.device_names import (
    display_device_name,
    guess_device_type_from_fingerprint,
    guess_maker_from_signals,
)
from app.models.lock import Device
from app.models.family import get_family


def test_setup_devices_filters_gateway_and_box(client, db, parent_headers):
    """GET /devices hides is_gateway and is_box during setup."""
    fam = get_family(db)
    fam.setup_step = 1
    d1 = Device(
        mac="aa:bb:cc:dd:ee:01", name="Phone", status="unassigned", is_gateway=False, is_box=False
    )
    d2 = Device(
        mac="aa:bb:cc:dd:ee:02", name="Gateway", status="unassigned", is_gateway=True, is_box=False
    )
    d3 = Device(
        mac="aa:bb:cc:dd:ee:03", name="Box", status="unassigned", is_gateway=False, is_box=True
    )
    db.add_all([d1, d2, d3])
    db.commit()

    resp = client.get("/api/v1/devices", headers=parent_headers)
    assert resp.status_code == 200
    devices = resp.json()
    assert len(devices) == 1
    assert devices[0]["mac"] == "aa:bb:cc:dd:ee:01"


def test_rescan_requires_auth(client, db):
    """POST /devices/rescan requires parent auth."""
    resp = client.post("/api/v1/devices/rescan")
    assert resp.status_code == 401


def test_rescan_returns_429_within_10s(client, db, parent_headers):
    """POST /devices/rescan rate-limited to once per 10s."""
    fam = get_family(db)
    fam.last_rescan_at = datetime.now(UTC).replace(tzinfo=None) - timedelta(seconds=5)
    db.commit()

    resp = client.post("/api/v1/devices/rescan", headers=parent_headers)
    assert resp.status_code == 429


def test_rescan_succeeds_after_10s(client, db, parent_headers):
    """POST /devices/rescan succeeds after 10s."""
    fam = get_family(db)
    fam.last_rescan_at = datetime.now(UTC).replace(tzinfo=None) - timedelta(seconds=11)
    db.commit()

    resp = client.post("/api/v1/devices/rescan", headers=parent_headers)
    assert resp.status_code == 200
    assert resp.json()["ok"] is True


def test_display_device_name_priority():
    """display_device_name follows priority: mDNS > hostname > fingerprint > vendor > unknown."""
    assert display_device_name("phone.local", "host1", "1,3,6", "Apple")[0] == "phone.local"
    assert display_device_name(None, "host1", "1,3,6", "Apple")[0] == "host1"
    assert display_device_name(None, None, "1,121,3,6,15,119,252", "Unknown")[0] == "iPhone"
    assert display_device_name(None, None, None, "Apple")[0] == "Apple device"
    assert display_device_name(None, None, None, None)[0] == "Unknown device"


def test_fingerprint_table_maps_to_device_types():
    """DHCP fingerprints map to common device types."""
    assert guess_device_type_from_fingerprint("1,121,3,6,15,119,252", None) == "iPhone"
    assert guess_device_type_from_fingerprint("1,33,3,6,7,31,42", None) == "Android phone"
    assert guess_device_type_from_fingerprint("1,15,3,6,44,46,47", None) == "Windows PC"
    assert guess_device_type_from_fingerprint("unknown", None) is None


def test_maker_guess_for_private_macs():
    """maker_guess extracts vendor from mDNS/DHCP for private MACs."""
    assert guess_maker_from_signals(None, "iphone.local") == "Apple"
    assert guess_maker_from_signals(None, "pixel.local") is None
    assert guess_maker_from_signals("1,3,6", None) is None


def test_setup_devices_response_format(db):
    """_setup_devices returns correct format with display_name, name_source, maker_guess."""
    d = Device(
        mac="aa:bb:cc:dd:ee:ff",
        name="Test",
        mdns_name="test.local",
        status="unassigned",
        is_gateway=False,
        is_box=False,
    )
    db.add(d)
    db.commit()

    result = _setup_devices([d])
    assert len(result) == 1
    assert "display_name" in result[0]
    assert "name_source" in result[0]
    assert "maker_guess" in result[0]
    assert "random_mac" in result[0]
