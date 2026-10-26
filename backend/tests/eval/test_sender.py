import httpx
import pytest
from app.eval import sender, store

NOW = 1_000_000.0


class Fake:
    def __init__(self, *answers):
        self.answers = list(answers)
        self.calls = []

    def __call__(self, url, **kw):
        self.calls.append((url, kw))
        a = self.answers.pop(0) if len(self.answers) > 1 else self.answers[0]
        if isinstance(a, Exception):
            raise a
        status, js = a if isinstance(a, tuple) else (a, {})
        return httpx.Response(status, json=js, request=httpx.Request("POST", url))


@pytest.fixture
def fake(monkeypatch):
    def install(*answers):
        f = Fake(*answers)
        monkeypatch.setattr("app.eval.sender.httpx.post", f)
        return f

    return install


def _fb(shots=None, fid="f1"):
    return {
        "id": fid,
        "household": store.household(),
        "type": "bug",
        "stars": 4,
        "text": "secret words",
        "route": "/x",
        "app_version": "1-eval",
        "errors": [],
        "created_at": "2026-01-01T00:00:00Z",
        "shots": shots or [],
    }


def _count():
    return len(store.due(NOW + 10**7, 100))


def test_umami_headers(eval_on, fake):
    f = fake(200)
    store.enqueue("umami", {"type": "event"}, NOW)
    assert sender.flush(NOW) == 1
    url, kw = f.calls[0]
    assert url == "http://umami.test/api/send"
    assert kw["headers"]["User-Agent"] == sender.UA
    assert kw["headers"]["X-Eval-Client-IP"] == "192.0.2.1"
    assert _count() == 0


def test_umami_4xx_drops(eval_on, fake):
    fake(400)
    store.enqueue("umami", {}, NOW)
    assert sender.flush(NOW) == 1
    assert _count() == 0


def test_umami_bot_answer_counts_as_sent(eval_on, fake):
    fake((200, {"beep": "boop"}))
    store.enqueue("umami", {}, NOW)
    assert sender.flush(NOW) == 1
    assert _count() == 0


def test_flush_stops_on_network_error(eval_on, fake):
    f = fake(httpx.ConnectError("down"))
    for _ in range(3):
        store.enqueue("umami", {}, NOW)
    assert sender.flush(NOW) == 0
    assert len(f.calls) == 1
    rows = store.due(NOW + 10**7, 10)
    assert len(rows) == 3
    assert rows[0].attempts == 1


def test_prune_keeps_feedback(eval_on, fake):
    fake(500)
    old = NOW - 15 * 86400
    store.enqueue("umami", {}, old)
    store.enqueue("feedback", _fb(), old)
    sender.flush(NOW)
    rows = store.due(NOW + 10**7, 10)
    assert [r.kind for r in rows] == ["feedback"]


def test_feedback_upload_then_row(eval_on, fake):
    f = fake(200, 201)
    shots = eval_on / "eval-shots"
    shots.mkdir()
    (shots / "abc.jpg").write_bytes(b"img")
    body = _fb(["abc.jpg"])
    store.enqueue("feedback", body, NOW)
    assert sender.flush(NOW) == 1
    hh = body["household"]
    u1, k1 = f.calls[0]
    assert u1 == f"http://supa.test/storage/v1/object/feedback-shots/{hh}/f1-0.jpg"
    assert k1["headers"]["Content-Type"] == "image/jpeg"
    u2, k2 = f.calls[1]
    assert u2 == "http://supa.test/rest/v1/feedback"
    assert k2["headers"]["Prefer"] == "return=minimal"
    assert k2["json"]["screenshot_paths"] == [f"{hh}/f1-0.jpg"]
    assert "shots" not in k2["json"]
    assert not (shots / "abc.jpg").exists()


def test_feedback_retry_after_partial_upload(eval_on, fake):
    shots = eval_on / "eval-shots"
    shots.mkdir()
    (shots / "abc.jpg").write_bytes(b"img")
    store.enqueue("feedback", _fb(["abc.jpg"]), NOW)
    fake(200, 500)
    assert sender.flush(NOW) == 0
    assert (shots / "abc.jpg").exists()
    fake((400, {"error": "Duplicate"}), 201)
    assert sender.flush(NOW + 10**5) == 1
    assert not (shots / "abc.jpg").exists()
    assert _count() == 0
