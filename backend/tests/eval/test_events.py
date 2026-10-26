from app.core.config import settings
from app.eval import events, store
from app.eval.config import eval_settings


def test_clean_drops_unknown_keys():
    assert events.clean("screen_view", {"route": "/kids", "name": "Mia"}) == {"route": "/kids"}


def test_clean_route_free_text():
    assert events.clean("screen_view", {"route": "/kids/12?x=1"}) == {"route": "other"}


def test_clean_wizard():
    assert events.clean("wizard_step", {"step": "3", "state": "done"}) == {
        "step": 3,
        "state": "done",
    }
    assert events.clean("wizard_step", {"step": 9, "state": "done"}) is None
    assert events.clean("wizard_step", {"step": 2, "state": "x"}) is None
    assert events.clean("wizard_done", {"a": 1}) == {}


def test_clean_form_abandoned():
    assert events.clean("form_abandoned", {"form": "kid"}) == {"form": "kid"}
    assert events.clean("form_abandoned", {"form": "Mia"}) is None


def test_clean_error_kind():
    assert events.clean("error_shown", {"kind": "http_404"}) == {"kind": "http_404"}
    assert events.clean("error_shown", {"kind": "Kid Mia not found"}) == {"kind": "other"}


def test_clean_rejects_box_names():
    assert events.clean("heartbeat", {}) is None
    assert events.clean("first_lock", {}) is None
    assert events.clean("bogus", {}) is None


def test_duration_bucket():
    got = [events.duration_bucket(m) for m in (None, 15, 60, 300, 1440)]
    assert got == ["until_cleared", "30m", "2h", "8h", "24h"]


def test_emit_payload(eval_on):
    events.emit("chore_done", {}, source="kid", age_group="8–10")
    rows = store.due(9e12)
    assert len(rows) == 1 and rows[0].kind == "umami"
    p = rows[0].body["payload"]
    assert p["website"] == eval_settings.EVAL_UMAMI_WEBSITE_ID
    assert p["id"] == store.household()
    assert p["ip"] == "192.0.2.1"
    assert p["data"]["source"] == "kid"
    assert p["data"]["age_group"] == "8–10"
    assert p["data"]["app_version"].endswith("-eval")


def test_emit_off_is_silent(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "DATA_DIR", tmp_path)
    monkeypatch.setattr(eval_settings, "EVAL_UMAMI_URL", "")
    events.emit("box_boot")
    assert not (tmp_path / "eval.db").exists()
