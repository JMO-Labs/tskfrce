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
    monkeypatch.setattr(fingerbank, "_lookup", lambda *a: pytest.fail("looked up"))
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
                return {
                    "device": {
                        "name": "Android OS",
                        "parents": [{"name": "Google OS"}, {"name": "Operating System"}],
                    },
                    "score": 87,
                }  # noqa: E501

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
    assert n(cls=ANDROID, mdns="pixel.local")[1] == "mdns"
    assert n(cls=ANDROID, fp="1,3,6,7,31")[1] == "device_class"
    assert n(mdns="tv.local", host="h1")[1] == "mdns"
    assert n(host="h1", vendor="Liteon") == ("h1", "hostname")
    assert n(vendor="Liteon") == ("Liteon device", "vendor")


def test_os_family_conflict_blocks_relink():
    a = Device(device_class=ANDROID)
    assert _conflict(a, Device(device_class=IOS))
    assert not _conflict(a, Device(device_class="Operating System/Google OS/Android OS 14"))
    assert not _conflict(a, Device())


def test_cloud_key_never_logged(monkeypatch, caplog):
    import logging

    monkeypatch.setattr(settings, "FINGERBANK_CLOUD", True)
    monkeypatch.setattr(settings, "FINGERBANK_API_KEY", "s3cr3t-key")
    monkeypatch.setattr(
        fingerbank.httpx.HTTPTransport,
        "handle_request",
        lambda self, req: fingerbank.httpx.Response(200, json={}, request=req),
    )
    caplog.set_level(logging.INFO)
    fingerbank.lookup("1,3", "host")
    assert "s3cr3t-key" not in caplog.text


def test_name_beats_model_beats_class():
    assert display_device_name("tv.local", "h", None, "V", None, "Pixel 8")[1] == "mdns"
    assert display_device_name(None, "h", None, "V", ANDROID, "Pixel 8")[1] == "hostname"
    assert display_device_name(None, None, None, "V", ANDROID, "Pixel 8") == ("Pixel 8", "model")
    assert display_device_name(None, "1234567890abcdef", None, "V", ANDROID) == (
        "Android device",
        "device_class",
    )


def test_subtitle():
    from app.lock.device_names import device_subtitle

    assert device_subtitle("h", "hostname", ANDROID, "Pixel 8", "V") == "Android device"
    assert device_subtitle("h", "hostname", None, "Pixel 8", "V") == "Pixel 8"
    assert device_subtitle("h", "hostname", None, None, "Acme") == "Acme"
    assert device_subtitle("h", "hostname", None, None, None) is None
    assert device_subtitle("Pixel 8", "model", ANDROID, "Pixel 8", "V") == "Android device"
    assert device_subtitle("Android device", "device_class", ANDROID, None, "V") == "V"
    assert device_subtitle("Android device", "device_class", ANDROID, None, None) is None
    assert device_subtitle("Pixel 8", "model", None, "Pixel 8", "V") == "V"
    assert device_subtitle("Acme device", "vendor", None, None, "Acme") is None
    assert device_subtitle("Unknown device", "unknown", None, None, None) is None
    assert device_subtitle("Kid's tablet", "parent", ANDROID, None, "V") == "Android device"


def test_ip_like_hostname_never_a_name():
    for h in ("192-168-1-242.maas", "10-0-0-5", "1-2-3-4.lan"):
        assert display_device_name(None, h, None, "Acme") == ("Acme device", "vendor")
    assert display_device_name(None, "192-168-1-9.maas", None, None)[0] == "Unknown device"
    assert display_device_name(None, "k1-n2.maas", None, None)[0] == "k1-n2.maas"
    assert display_device_name("10-0-0-5.local", None, None, None)[1] == "unknown"
