"""Fingerbank offline DB provisioning: opt-in, weekly refresh, failures keep the old DB."""

from datetime import UTC, datetime, timedelta

import pytest
from app.core.config import settings
from app.lock import fingerbank, fingerbank_db
from app.models.family import get_family
from tests.lock.test_fingerbank import make_db

F = "/api/v1/family"


@pytest.fixture(autouse=True)
def _env(monkeypatch, tmp_path):
    fingerbank.cache_clear()
    monkeypatch.setattr(settings, "DATA_DIR", tmp_path)
    for k, v in (("FINGERBANK_DB_PATH", None), ("FINGERBANK_CLOUD", False),
                 ("FINGERBANK_API_KEY", None)):  # fmt: skip
        monkeypatch.setattr(settings, k, v)
    calls = []

    def fake(key, dest):
        calls.append(key)
        make_db(dest)

    monkeypatch.setattr(fingerbank_db, "_download", fake)
    yield calls
    fingerbank.cache_clear()


def _enable(db, key="k1", cloud=False):
    fam = get_family(db)
    fam.fingerbank_enabled, fam.fingerbank_api_key, fam.fingerbank_cloud = True, key, cloud
    db.commit()
    return fam


def test_off_means_no_download_and_no_lookup(db, _env):
    assert fingerbank_db.refresh(db) is False
    fingerbank_db.tick(db)
    assert _env == [] and settings.FINGERBANK_DB_PATH is None
    assert fingerbank.lookup("1,3,6,15") is None


def test_enabled_without_key_does_nothing(db, _env):
    fam = _enable(db, key=None)
    assert fingerbank_db.refresh(db) is False and _env == []
    assert fam.fingerbank_synced_at is None


def test_enable_downloads_sets_path_and_lookup_works(db, _env):
    fam = _enable(db)
    assert fingerbank_db.refresh(db) is True
    assert _env == ["k1"]
    assert settings.FINGERBANK_DB_PATH == str(settings.DATA_DIR / "fingerbank.sqlite")
    assert fam.fingerbank_synced_at is not None
    assert fingerbank.lookup("1,3,6,15")[0].endswith("Android OS")


def test_not_refreshed_again_within_a_week(db, _env):
    _enable(db)
    fingerbank_db.refresh(db)
    assert fingerbank_db.refresh(db) is False
    fam = get_family(db)
    fam.fingerbank_synced_at = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=8)
    db.commit()
    assert fingerbank_db.refresh(db) is True
    assert len(_env) == 2


def test_failed_download_keeps_previous_db(db, _env, monkeypatch):
    fam = _enable(db)
    fingerbank_db.refresh(db)
    path = settings.DATA_DIR / "fingerbank.sqlite"
    before, synced = path.read_bytes(), fam.fingerbank_synced_at

    def boom(key, dest):
        dest.write_bytes(b"partial")
        raise OSError("down")

    monkeypatch.setattr(fingerbank_db, "_download", boom)
    fam.fingerbank_synced_at = synced - timedelta(days=9)
    db.commit()
    assert fingerbank_db.refresh(db) is False
    assert path.read_bytes() == before
    assert settings.FINGERBANK_DB_PATH == str(path)
    assert not list(settings.DATA_DIR.glob("fingerbank*.tmp"))


def test_garbage_download_is_rejected(db, _env, monkeypatch):
    _enable(db)
    monkeypatch.setattr(fingerbank_db, "_download", lambda k, d: d.write_bytes(b"<html>nope"))
    assert fingerbank_db.refresh(db) is False
    assert settings.FINGERBANK_DB_PATH is None


def test_disabling_stops_lookups(db, _env):
    fam = _enable(db)
    fingerbank_db.refresh(db)
    fam.fingerbank_enabled = False
    db.commit()
    fingerbank_db.apply(fam)
    assert settings.FINGERBANK_DB_PATH is None
    assert fingerbank.lookup("1,3,6,15") is None


def test_cloud_is_a_separate_opt_in(db, _env):
    fam = _enable(db, cloud=False)
    fingerbank_db.apply(fam)
    assert settings.FINGERBANK_CLOUD is False
    fam.fingerbank_cloud = True
    fingerbank_db.apply(fam)
    assert settings.FINGERBANK_CLOUD is True and settings.FINGERBANK_API_KEY == "k1"


def test_api_saves_key_hides_it_and_downloads(client, parent_headers, _env):
    body = {"fingerbank_enabled": True, "fingerbank_api_key": " abc "}
    r = client.patch(F, json=body, headers=parent_headers)
    assert r.status_code == 200
    j = r.json()
    assert j["fingerbank_enabled"] is True and j["fingerbank_key_set"] is True
    assert "fingerbank_api_key" not in j and "abc" not in r.text
    assert _env == []  # the download happens in the background loop, not the request


def test_api_hint_seen(client, parent_headers):
    assert client.get(F, headers=parent_headers).json()["fingerbank_hint_seen"] is False
    r = client.patch(F, json={"fingerbank_hint_seen": True}, headers=parent_headers)
    assert r.json()["fingerbank_hint_seen"] is True


def test_tick_downloads_off_thread_only_when_due(db, _env, monkeypatch):
    started = []

    class T:
        def __init__(self, target, daemon):
            self.target = target

        def start(self):
            started.append(self.target)

    monkeypatch.setattr(fingerbank_db.threading, "Thread", T)
    fingerbank_db.tick(db)
    assert started == []  # setting off
    _enable(db)
    fingerbank_db.tick(db)
    assert started == [fingerbank_db._bg]


# --- failures: last error, backoff, env, choice, discovery (review of tskfrce#105) ---


def _fail(monkeypatch, exc):
    calls = []

    def boom(key, dest):
        calls.append(key)
        raise exc

    monkeypatch.setattr(fingerbank_db, "_download", boom)
    return calls


def _status(code):
    import httpx

    req = httpx.Request("GET", "https://api.fingerbank.org/x?key=SECRET")
    return httpx.HTTPStatusError("x", request=req, response=httpx.Response(code, request=req))


@pytest.mark.parametrize(
    ("exc", "code"),
    [(_status(401), "bad_key"), (_status(403), "bad_key"), (_status(429), "rate_limited"),
     (__import__("httpx").ConnectError("down"), "offline"), (RuntimeError("x"), "failed")],
)  # fmt: skip
def test_failure_records_last_error_without_the_key(db, _env, monkeypatch, exc, code):
    fam = _enable(db, key="SECRET")
    _fail(monkeypatch, exc)
    assert fingerbank_db.refresh(db) is False
    assert fam.fingerbank_last_error == code and fam.fingerbank_last_error_at is not None
    assert "SECRET" not in code


def test_garbage_download_records_invalid(db, _env, monkeypatch):
    fam = _enable(db)
    monkeypatch.setattr(fingerbank_db, "_download", lambda k, d: d.write_bytes(b"<html>nope"))
    fingerbank_db.refresh(db)
    assert fam.fingerbank_last_error == "invalid_db"


def test_success_clears_last_error(db, _env, monkeypatch):
    fam = _enable(db)
    fam.fingerbank_last_error = "offline"
    db.commit()
    assert fingerbank_db.refresh(db, force=True) is True
    assert fam.fingerbank_last_error is None and fam.fingerbank_last_error_at is None


class _NoClose:
    def __init__(self, db):
        self._db = db

    def __getattr__(self, name):
        return getattr(self._db, name)

    def close(self):
        pass


def test_failed_refresh_is_not_retried_on_next_tick(db, _env, monkeypatch):
    started = []

    class T:
        def __init__(self, target, daemon):
            self.target = target

        def start(self):
            started.append(1)
            self.target()

    monkeypatch.setattr(fingerbank_db.threading, "Thread", T)
    # _bg closes its session: hand it a proxy so the test session stays usable. Patching
    # db.close itself would outlive the db fixture teardown (autouse monkeypatch is set up
    # first) and leave the Postgres session idle in transaction, hanging the next TRUNCATE.
    monkeypatch.setattr("app.core.database.SessionLocal", lambda: _NoClose(db))
    fam = _enable(db)
    calls = _fail(monkeypatch, _status(401))
    fingerbank_db.tick(db)
    fingerbank_db.tick(db)
    assert calls == ["k1"] and len(started) == 1
    # still blocked after the short backoff for a bad key; open after a day
    fam.fingerbank_attempted_at -= timedelta(hours=2)
    assert fingerbank_db._due(fam) is False
    fam.fingerbank_attempted_at -= timedelta(days=1)
    assert fingerbank_db._due(fam) is True


def test_offline_backoff_is_one_hour(db, _env, monkeypatch):
    fam = _enable(db)
    _fail(monkeypatch, OSError("down"))
    fingerbank_db.refresh(db)
    assert fingerbank_db._due(fam) is False
    fam.fingerbank_attempted_at -= timedelta(minutes=61)
    assert fingerbank_db._due(fam) is True


def test_cloud_failure_is_persisted_backed_off_and_cleared(db, _env, monkeypatch):
    import httpx

    fam = _enable(db, cloud=True)
    gets = []

    def get(*a, **k):
        gets.append(1)
        raise httpx.ConnectError("down")

    monkeypatch.setattr(fingerbank.httpx, "get", get)
    fingerbank_db.apply(fam)
    assert fingerbank.lookup("9,9,9") is None and fingerbank.lookup("8,8,8") is None
    assert len(gets) == 1  # backed off: no second request
    fingerbank_db.tick(db)
    assert fam.fingerbank_last_error == "cloud_offline"
    fingerbank.cloud_reset()
    monkeypatch.setattr(
        fingerbank.httpx, "get",
        lambda *a, **k: type("R", (), {"raise_for_status": lambda s: None,
                                        "json": lambda s: {"device": {"name": "Android OS"}, "score": 80}})(),
    )  # fmt: skip
    assert fingerbank.lookup("7,7,7") is not None
    fingerbank_db.tick(db)
    assert fam.fingerbank_last_error is None


def test_cloud_replaces_offline_download(db, _env):
    fam = _enable(db, cloud=True)
    assert fingerbank_db.refresh(db) is False and _env == []
    fingerbank_db.apply(fam)
    assert settings.FINGERBANK_DB_PATH is None and settings.FINGERBANK_CLOUD is True


def test_env_values_survive_when_family_setting_is_off(db, _env, monkeypatch):
    monkeypatch.setattr(fingerbank_db, "_ENV", ("/env/fb.sqlite", True, "ENVKEY"))
    fingerbank_db.apply(get_family(db))
    assert (settings.FINGERBANK_DB_PATH, settings.FINGERBANK_CLOUD) == ("/env/fb.sqlite", True)
    assert settings.FINGERBANK_API_KEY == "ENVKEY"


def test_api_exposes_last_error_not_key(client, parent_headers, db):
    fam = get_family(db)
    fam.fingerbank_last_error = "bad_key"
    fam.fingerbank_last_error_at = datetime(2026, 1, 1)
    db.commit()
    j = client.get(F, headers=parent_headers).json()
    assert j["fingerbank_last_error"] == "bad_key" and j["fingerbank_last_error_at"]


def _seen(client, **kw):
    from tests.test_device_relink import seen

    return seen(client, **kw)


def test_discovery_sets_class_when_on_and_passes_hostname(client, db, _env, monkeypatch):
    from app.models.lock import Device

    _enable(db)
    fingerbank_db.refresh(db)
    seen_args = []
    real = fingerbank.lookup
    monkeypatch.setattr(
        "app.api.internal.fingerbank.lookup",
        lambda fp, host=None: (seen_args.append((fp, host)), real(fp, host))[1],
    )
    did = _seen(client, dhcp_fp="1,3,6,15", hostname="tims-phone")
    d = db.get(Device, did)
    assert d.device_class and d.device_class.endswith("Android OS") and d.device_class_score
    assert seen_args == [("1,3,6,15", "tims-phone")]


def test_discovery_leaves_class_empty_when_off(client, db, _env):
    from app.models.lock import Device

    did = _seen(client, dhcp_fp="1,3,6,15")
    assert db.get(Device, did).device_class is None


def test_device_out_has_friendly_class_and_notice_names_it(client, db, parent_headers, _env):
    from app.models.inbox import Notification

    _enable(db)
    fingerbank_db.refresh(db)
    did = _seen(client, dhcp_fp="1,3,6,15")
    rows = client.get("/api/v1/devices", headers=parent_headers).json()
    d = next(x for x in rows if x["id"] == did)
    assert d["device_class"] == "Android device"
    n = db.query(Notification).filter_by(kind="new_device", device_id=did).one()
    assert "Android device" in n.body
