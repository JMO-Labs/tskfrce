import httpx
import pytest
from app.core.config import settings
from app.models.kid_device import KidDevice
from app.services import inbox, kid_enroll, push

TOPIC = "u" * 32


class Call:
    def __init__(self, url, json, headers):
        self.url, self.json, self.headers = url, json, headers


@pytest.fixture
def calls(monkeypatch):
    out = []

    def post(url, json=None, headers=None, timeout=None):
        out.append(Call(url, json, headers or {}))
        return httpx.Response(200, request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx, "post", post)
    monkeypatch.setattr(push, "_spawn", lambda fn, *a: fn(*a))
    monkeypatch.setattr(settings, "NTFY_URL", "http://ntfy:80")
    monkeypatch.setattr(settings, "BOX_URL", "http://192.168.1.20:3000")
    monkeypatch.setattr(settings, "NTFY_PUBLIC_URL", None)
    monkeypatch.setattr(settings, "NTFY_UPSTREAM_URL", "https://ntfy.sh")
    monkeypatch.setattr(settings, "NTFY_UPSTREAM_TOKEN", None)
    return out


@pytest.fixture
def k(db, kid):
    kid.full_name = "Sam"
    kid.push_topic = "lan1"
    kid.alert_topic = TOPIC
    db.commit()
    return kid


def _fire(db, kid):
    push.queue(db, kid.id, "chore_new", "New chore: Clean Sam's room", "Due 5 pm")
    db.commit()


def test_upstream_payload_is_generic(db, k, calls):
    _fire(db, k)
    up = [c for c in calls if c.url == "https://ntfy.sh/"][0]
    assert up.json == {
        "topic": TOPIC,
        "title": "t@sk4ce",
        "message": "You have a new chore",
        "priority": 3,
    }
    assert "Sam" not in str(up.json) and "Clean" not in str(up.json)
    assert "Authorization" not in up.headers


def test_every_kid_kind_has_generic_text():
    assert inbox.KID_KINDS <= push.GENERIC.keys()


def test_lan_send_unchanged(db, k, calls):
    _fire(db, k)
    lan = calls[0]
    assert lan.url == "http://ntfy:80/"
    assert lan.json["title"] == "New chore: Clean Sam's room"
    assert lan.json["click"] == "http://192.168.1.20:3000/kid" and "_up" not in lan.json


def test_upstream_down_lan_still_sent(db, k, calls, monkeypatch):
    def boom(url, **kw):
        calls.append(url)
        if "ntfy.sh" in url:
            raise httpx.ConnectTimeout("t")
        return httpx.Response(200, request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx, "post", boom)
    _fire(db, k)
    assert calls == ["http://ntfy:80/", "https://ntfy.sh/"]


def test_upstream_queued_after_lan(db, k, calls):
    _fire(db, k)
    assert [c.url for c in calls] == ["http://ntfy:80/", "https://ntfy.sh/"]


def test_token_header_only_when_set(db, k, calls, monkeypatch):
    monkeypatch.setattr(settings, "NTFY_UPSTREAM_TOKEN", "")
    _fire(db, k)
    assert "Authorization" not in calls[-1].headers
    monkeypatch.setattr(settings, "NTFY_UPSTREAM_TOKEN", "tk_x")
    _fire(db, k)
    assert calls[-1].headers["Authorization"] == "Bearer tk_x"
    assert "Authorization" not in calls[-2].headers  # LAN call has none


def test_self_hosted_url_used_as_is(db, k, calls, monkeypatch):
    monkeypatch.setattr(settings, "NTFY_UPSTREAM_URL", "https://ntfy.example.net/")
    _fire(db, k)
    assert calls[-1].url == "https://ntfy.example.net/"


def test_upstream_off_when_empty(db, k, calls, monkeypatch):
    monkeypatch.setattr(settings, "NTFY_UPSTREAM_URL", "")
    _fire(db, k)
    assert [c.url for c in calls] == ["http://ntfy:80/"]


def test_no_alert_topic_no_upstream(db, k, calls):
    k.alert_topic = None
    db.commit()
    _fire(db, k)
    assert [c.url for c in calls] == ["http://ntfy:80/"]


def test_upstream_works_without_lan(db, k, calls, monkeypatch):
    monkeypatch.setattr(settings, "NTFY_URL", None)
    _fire(db, k)
    assert [c.url for c in calls] == ["https://ntfy.sh/"]


def test_remove_phone_rotates_topic(client, kid, db, parent_headers):
    old = None
    toks = []
    for _ in range(2):
        raw = kid_enroll.issue(db, kid, kid)[0]
        r = client.post("/api/v1/kid/enroll", json={"token": raw}).json()
        toks.append(r["device_token"])
        old = r["alert"]["topic"]
    first = db.query(KidDevice).order_by(KidDevice.id).first()
    r = client.delete(f"/api/v1/kids/{kid.id}/phones/{first.id}", headers=parent_headers)
    assert r.status_code == 204
    new = client.post("/api/v1/kid/session", json={"device_token": toks[1]}).json()["alert"]
    assert new["topic"] != old and len(new["topic"]) >= 32
