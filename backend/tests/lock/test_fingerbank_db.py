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
