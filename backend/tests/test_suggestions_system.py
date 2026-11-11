import json
from datetime import UTC, datetime, timedelta

import pytest
from app.api import updates
from app.models.family import get_family
from app.services import box_power

U = "/api/v1/suggestions"


@pytest.fixture(autouse=True)
def _env(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.delenv("UPDATE_CHANNEL", raising=False)


@pytest.fixture
def internal_headers():
    from app.core.config import settings

    return {"X-Internal-Token": settings.INTERNAL_TOKEN}


def _items(client, h):
    return {i["rule"]: i for i in client.get(U, headers=h).json()["items"]}


def test_update_ready(client, parent_headers):
    updates._write_state({"major_available": "2"})
    s = _items(client, parent_headers)["update.ready"]
    assert s["action"]["to"].startswith("/settings") and "2" in s["body"]


def test_update_ready_absent(client, parent_headers):
    updates._write_state({"last_result": "success"})
    assert "update.ready" not in _items(client, parent_headers)


def test_update_failed_and_dismiss(client, parent_headers):
    updates._write_state({"last_result": "failed", "last_version": "1.2.0"})
    s = _items(client, parent_headers)["update.failed"]
    client.post(
        f"{U}/dismiss",
        json={"key": s["key"], "fingerprint": s["fingerprint"]},
        headers=parent_headers,
    )
    assert "update.failed" not in _items(client, parent_headers)
    updates._write_state({"last_result": "success"})
    assert "update.failed" not in _items(client, parent_headers)


def test_update_result_records_rollback_health(client, internal_headers, parent_headers):
    client.post(
        "/internal/update-result",
        json={"result": "failed", "version": "2", "rollback_healthy": False},
        headers=internal_headers,
    )
    assert updates._read_state()["rollback_unhealthy"] is True
    client.post("/internal/update-result", json={"result": "success"}, headers=internal_headers)
    assert not updates._read_state().get("rollback_unhealthy")


def _cert(tmp_path, days):
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.x509.oid import NameOID

    key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "box")])
    now = datetime.now(UTC)
    c = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(1)
        .not_valid_before(now - timedelta(days=60))
        .not_valid_after(now + timedelta(days=days))
        .sign(key, hashes.SHA256())
    )
    d = tmp_path / "lego" / "certificates"
    d.mkdir(parents=True)
    (d / "box.example.crt").write_bytes(c.public_bytes(serialization.Encoding.PEM))


def test_cert_expiring(client, parent_headers, tmp_path):
    _cert(tmp_path, 5)
    assert "cert.expiring" in _items(client, parent_headers)


def test_cert_fine(client, parent_headers, tmp_path):
    _cert(tmp_path, 60)
    assert "cert.expiring" not in _items(client, parent_headers)


def test_cert_missing_or_unreadable_skipped(client, parent_headers, tmp_path):
    assert "cert.expiring" not in _items(client, parent_headers)
    d = tmp_path / "lego" / "certificates"
    d.mkdir(parents=True)
    (d / "bad.crt").write_text("not a cert")
    assert "cert.expiring" not in _items(client, parent_headers)


# --- power ---


def _at(h, m, days_ago=0):
    return datetime.utcnow().replace(hour=h, minute=m, second=0, microsecond=0) - timedelta(
        days=days_ago
    )


def test_heartbeat_writes_timestamp(tmp_path):
    box_power.heartbeat(datetime(2026, 1, 1, 12, 0))
    assert (tmp_path / "last-alive").read_text().strip() == "2026-01-01T12:00:00"


def test_clean_shutdown_is_not_an_outage(tmp_path):
    box_power.heartbeat(datetime(2026, 1, 1, 12, 0))
    box_power.mark_clean_shutdown()
    assert box_power.check_boot(datetime(2026, 1, 1, 12, 30)) is None
    assert not (tmp_path / "outages.json").exists()


def test_first_boot_is_not_an_outage(tmp_path):
    assert box_power.check_boot(datetime(2026, 1, 1, 12, 30)) is None


def test_unclean_boot_records_outage_and_rearms(tmp_path):
    box_power.heartbeat(datetime(2026, 1, 1, 19, 10))
    out = box_power.check_boot(datetime(2026, 1, 1, 19, 52))
    assert out == {"start": "2026-01-01T19:10:00", "end": "2026-01-01T19:52:00"}
    assert json.loads((tmp_path / "outages.json").read_text()) == [out]
    # marker is cleared at boot, so a crash after this boot is detected again
    assert not (tmp_path / "clean-shutdown").exists()


def test_power_suggestion_text_and_effects(client, parent_headers, db):
    get_family(db).timezone = "UTC"
    db.commit()
    box_power.heartbeat(_at(19, 10))
    box_power.check_boot(_at(19, 52))
    s = _items(client, parent_headers)["box.power"]
    assert s["title"] == "The box was off 19:10–19:52"
    assert "ups" not in s["body"].lower()
    assert "guess" not in s["body"].lower()


def test_power_suggestion_only_confirmable_effects(client, parent_headers, monkeypatch):
    monkeypatch.setattr(box_power.settings, "LOCK_LOOP_ENABLED", False)
    box_power.heartbeat(_at(19, 10))
    box_power.check_boot(_at(19, 52))
    body = _items(client, parent_headers)["box.power"]["body"]
    assert "lock" not in body.lower()
    monkeypatch.setattr(box_power.settings, "LOCK_LOOP_ENABLED", True)
    assert "locks" in _items(client, parent_headers)["box.power"]["body"].lower()


def test_ups_tip_with_two_in_30_days(client, parent_headers):
    for d in (10, 0):
        box_power.heartbeat(_at(19, 10, d))
        box_power.check_boot(_at(19, 52, d))
    assert "ups" in _items(client, parent_headers)["box.power"]["body"].lower()


def test_no_ups_tip_when_second_is_old(client, parent_headers):
    for d in (45, 0):
        box_power.heartbeat(_at(19, 10, d))
        box_power.check_boot(_at(19, 52, d))
    assert "ups" not in _items(client, parent_headers)["box.power"]["body"].lower()


def test_old_outage_not_suggested(client, parent_headers):
    box_power.heartbeat(_at(19, 10, 20))
    box_power.check_boot(_at(19, 52, 20))
    assert "box.power" not in _items(client, parent_headers)
