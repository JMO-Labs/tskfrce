import sqlite3

import pytest
from app.core.config import settings
from app.lock import fingerbank
from app.lock.device_names import display_device_name
from app.lock.relink import _conflict
from app.models.lock import Device

ANDROID = "Operating System/Google OS/Android OS"
IOS = "Operating System/Apple OS/Apple iOS"


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    fingerbank.cache_clear()
    monkeypatch.setattr(settings, "FINGERBANK_DB_PATH", None)
    monkeypatch.setattr(settings, "FINGERBANK_CLOUD", False)
    monkeypatch.setattr(settings, "FINGERBANK_API_KEY", None)
    yield
    fingerbank.cache_clear()


def make_db(path):
    c = sqlite3.connect(path)
    c.executescript(
        """
        create table device(id integer primary key, name text, parent_id integer);
        create table dhcp_fingerprint(id integer primary key, value text);
        create table combination(id integer primary key, dhcp_fingerprint_id int,
                                 device_id int, score int);
        insert into device values (1,'Operating System',null),(2,'Google OS',1),(3,'Android OS',2);
        insert into dhcp_fingerprint values (1,'1,3,6,15');
        insert into combination values (1,1,3,87),(2,1,2,40);
        """
    )
    c.commit()
    c.close()


def test_offline_lookup_picks_best_score(tmp_path, monkeypatch):
    p = tmp_path / "fb.db"
    make_db(p)
    monkeypatch.setattr(settings, "FINGERBANK_DB_PATH", str(p))
    assert fingerbank.lookup("1,3,6,15") == (ANDROID, 87)
    assert fingerbank.lookup("9,9") is None


def test_no_fingerprint_no_lookup(monkeypatch):
    monkeypatch.setattr(fingerbank, "_offline", lambda *a: pytest.fail("looked up"))
    assert fingerbank.lookup(None) is None and fingerbank.lookup("") is None


def test_no_db_no_key_returns_none_and_no_network(monkeypatch):
    monkeypatch.setattr(fingerbank.httpx, "get", lambda *a, **k: pytest.fail("network"))
    assert fingerbank.lookup("1,3") is None


def test_cloud_needs_optin_and_key(monkeypatch):
    calls = []

    def get(url, **kw):
        calls.append(kw)

        class R:
            def raise_for_status(self):
                pass

            def json(self):
                return {"device": {"name": "Android OS", "parents": [{"name": "Google OS"}, {"name": "Operating System"}]}, "score": 87}  # noqa: E501

        return R()

    monkeypatch.setattr(fingerbank.httpx, "get", get)
    monkeypatch.setattr(settings, "FINGERBANK_API_KEY", "k")
    assert fingerbank.lookup("1,3") is None  # key alone is not opt-in
    monkeypatch.setattr(settings, "FINGERBANK_CLOUD", True)
    assert fingerbank.lookup("1,3", "pixel") == (ANDROID, 87)
    assert fingerbank.lookup("1,3", "pixel") == (ANDROID, 87)
    assert len(calls) == 1  # cached


def test_failure_never_raises(monkeypatch):
    def boom(*a, **k):
        raise OSError("down")

    monkeypatch.setattr(fingerbank.httpx, "get", boom)
    monkeypatch.setattr(settings, "FINGERBANK_CLOUD", True)
    monkeypatch.setattr(settings, "FINGERBANK_API_KEY", "k")
    assert fingerbank.lookup("1,3") is None
    monkeypatch.setattr(settings, "FINGERBANK_DB_PATH", "/nonexistent/x.db")
    assert fingerbank.lookup("1,3") is None


def test_os_family():
    assert fingerbank.os_family(ANDROID) == "android"
    assert fingerbank.os_family(IOS) == "ios"
    assert fingerbank.os_family("Operating System/Windows OS/Windows 11") == "windows"
    assert fingerbank.os_family("Printer/Brother") is None
    assert fingerbank.os_family(None) is None


def test_naming_precedence():
    n = lambda **k: display_device_name(  # noqa: E731
        k.get("mdns"), k.get("host"), k.get("fp"), k.get("vendor"), k.get("cls")
    )
    assert n(cls=ANDROID, vendor="Liteon") == ("Android device", "device_class")
    assert n(cls=ANDROID, host="pixel")[1] == "hostname"
    assert n(cls=ANDROID, fp="1,3,6,7,31")[1] == "fingerprint"
    assert n(vendor="Liteon") == ("Liteon device", "vendor")


def test_os_family_conflict_blocks_relink():
    a = Device(device_class=ANDROID)
    assert _conflict(a, Device(device_class=IOS))
    assert not _conflict(a, Device(device_class="Operating System/Google OS/Android OS 14"))
    assert not _conflict(a, Device())
