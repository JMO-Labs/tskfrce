import os

from app.core.config import settings
from app.eval import store

P = "/api/v1/eval"
JPEG = b"\xff\xd8\xff\xe0" + b"0" * 64


def _rows(kind):
    return [r for r in store.due(1e12, 100) if r.kind == kind]


def _fb(client, headers, data=None, files=None):
    d = {"type": "bug", "text": "Broken"}
    d.update(data or {})
    return client.post(f"{P}/feedback", data=d, files=files or [], headers=headers)


def _shot(name="a.jpg", ctype="image/jpeg", body=JPEG):
    return ("shots", (name, body, ctype))


def test_off_is_noop(client, parent_headers, kid, monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "DATA_DIR", tmp_path)
    r = client.get(f"{P}/status", headers=parent_headers)
    assert r.json() == {"stats": False, "feedback": False, "household": None}
    body = {"name": "screen_view", "props": {"route": "/"}}
    assert client.post(f"{P}/event", json=body, headers=parent_headers).status_code == 204
    assert _fb(client, parent_headers).status_code == 200
    put = client.put(f"{P}/kids/{kid.id}/age", json={"age_group": "14+"}, headers=parent_headers)
    assert put.status_code == 204
    assert not (tmp_path / "eval.db").exists()


def test_event_allow_list(client, eval_on, parent_headers, kid_headers, kid):
    put = client.put(f"{P}/kids/{kid.id}/age", json={"age_group": "8–10"}, headers=parent_headers)
    assert put.status_code == 204
    props = {"route": "/kid", "source": "parent", "age_group": "14+", "name": "Mia"}
    r = client.post(f"{P}/event", json={"name": "screen_view", "props": props}, headers=kid_headers)
    assert r.status_code == 204
    data = _rows("umami")[0].body["payload"]["data"]
    assert data == {
        "route": "/kid",
        "household": store.household(),
        "app_version": data["app_version"],
        "source": "kid",
        "age_group": "8–10",
    }


def test_unknown_event_dropped(client, eval_on, parent_headers):
    r = client.post(f"{P}/event", json={"name": "heartbeat", "props": {}}, headers=parent_headers)
    assert r.status_code == 204
    assert _rows("umami") == []


def test_wizard_done_records_time(client, eval_on, parent_headers):
    assert store.kv_get("wizard_done_at") is None
    client.post(f"{P}/event", json={"name": "wizard_done"}, headers=parent_headers)
    first = store.kv_get("wizard_done_at")
    assert first
    client.post(f"{P}/event", json={"name": "wizard_done"}, headers=parent_headers)
    assert store.kv_get("wizard_done_at") == first


def test_kid_cannot_set_age(client, kid_headers, kid):
    r = client.put(f"{P}/kids/{kid.id}/age", json={"age_group": "14+"}, headers=kid_headers)
    assert r.status_code == 403


def test_age_unknown_kid(client, eval_on, parent_headers, parent):
    for kid_id in (9999, parent.id):
        r = client.put(f"{P}/kids/{kid_id}/age", json={"age_group": "14+"}, headers=parent_headers)
        assert r.status_code == 404
        assert r.json()["detail"] == "That kid doesn't exist."


def test_feedback_queues(client, eval_on, parent_headers):
    data = {"stars": "4", "route": "/kids", "errors": "http_500,Mia broke"}
    r = _fb(client, parent_headers, data, [_shot()])
    assert r.status_code == 200 and r.json() == {"ok": True}
    body = _rows("feedback")[0].body
    assert body["errors"] == ["http_500"]
    assert body["type"] == "bug" and body["stars"] == 4 and body["route"] == "/kids"
    assert body["household"] == store.household()
    assert len(body["shots"]) == 1
    assert (eval_on / "eval-shots" / body["shots"][0]).read_bytes() == JPEG
    assert body["shots"][0] == f"{body['id']}-0.jpg"
    ev = _rows("umami")[0].body["payload"]
    assert ev["name"] == "feedback_sent" and ev["data"]["type"] == "bug"


def test_feedback_errors_only_for_bugs(client, eval_on, parent_headers):
    _fb(client, parent_headers, {"type": "feature", "errors": "http_500", "route": "/x"})
    body = _rows("feedback")[0].body
    assert body["errors"] == [] and body["route"] == "other" and body["stars"] is None


def test_feedback_rules(client, eval_on, parent_headers):
    def bad(msg, data=None, files=None):
        r = _fb(client, parent_headers, data, files)
        assert r.status_code == 422, msg
        assert r.json()["detail"] == msg

    bad("Pick Feature idea, Bug or Other.", {"type": "x"})
    bad("Write a short note first.", {"text": "  "})
    bad("Keep the note under 2,000 characters.", {"text": "a" * 2001})
    bad("Send up to 3 screenshots.", files=[_shot() for _ in range(4)])
    bad("Screenshots must be PNG, JPEG or WebP images.", files=[_shot("a.txt", "text/plain")])
    bad("Each screenshot must be under 3 MB.", files=[_shot(body=b"0" * (3 * 1024 * 1024 + 1))])
    bad("Stars go from 1 to 5.", {"stars": "6"})
    bad("Stars go from 1 to 5.", {"stars": "²"})
    assert _rows("feedback") == []


def test_seen_counts_requests(client, eval_on, parent_headers, kid_headers):
    for h in (parent_headers, parent_headers, kid_headers):
        client.get(f"{P}/status", headers=h)
    assert store.seen_counts(store.local_day()) == (1, 1)


def test_no_shots_dir_when_off(client, parent_headers, monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "DATA_DIR", tmp_path)
    _fb(client, parent_headers, files=[_shot()])
    assert os.listdir(tmp_path) == []


def test_feedback_errors_trailing_newline_dropped(client, eval_on, parent_headers):
    _fb(client, parent_headers, {"errors": "network\n,http_500", "type": "bug"})
    assert _rows("feedback")[0].body["errors"] == ["network", "http_500"]


def test_feedback_strips_nul(client, eval_on, parent_headers):
    assert _fb(client, parent_headers, {"text": "a\x00b"}).status_code == 200
    assert _rows("feedback")[0].body["text"] == "ab"
    assert _fb(client, parent_headers, {"text": "\x00"}).status_code == 422


def test_feature_event_counts_area(client, eval_on, parent_headers):
    body = {"name": "feature", "props": {"area": "goals", "action": "open"}}
    assert client.post(f"{P}/event", json=body, headers=parent_headers).status_code == 204
    assert store.counters(store.local_day()).get("feat:goals") == 1
