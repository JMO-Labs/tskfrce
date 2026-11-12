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
    assert events.clean("wizard_step", {"step": 7, "state": "done"}) == {"step": 7, "state": "done"}
    assert events.clean("wizard_step", {"step": 8, "state": "done"}) is None
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


def test_clean_malformed_inputs():
    assert events.clean("wizard_step", {"step": "²", "state": "done"}) is None
    assert events.clean("wizard_step", {"step": True, "state": "done"}) is None
    assert events.clean("screen_view", {"route": 5}) == {"route": "other"}
    assert events.clean("error_shown", {"kind": 5}) == {"kind": "other"}


def test_clean_error_kind_trailing_newline():
    assert events.clean("error_shown", {"kind": "network\n"}) == {"kind": "other"}


def test_clean_feature():
    assert events.clean("feature", {"area": "goals", "action": "open", "x": "Mia"}) == {
        "area": "goals",
        "action": "open",
    }
    assert events.clean("feature", {"area": "Mia", "action": "open"}) is None
    assert events.clean("feature", {"area": "goals", "action": "nuke"}) is None
    assert events.clean("feature", {"area": "wifi"}) is None
    assert events.clean("feature", {"area": ["goals"], "action": "open"}) is None


def test_clean_screen_view_section():
    ok = events.clean("screen_view", {"route": "/settings", "section": "wifi"})
    assert ok == {"route": "/settings", "section": "wifi"}
    assert events.clean("screen_view", {"route": "/kid", "section": "rewards"}) == {
        "route": "/kid",
        "section": "rewards",
    }
    assert events.clean("screen_view", {"route": "/settings", "section": "MyWifi"}) == {
        "route": "/settings"
    }
    assert events.clean("screen_view", {"route": "/wifi-setup"}) == {"route": "/wifi-setup"}


def test_clean_auth():
    assert events.clean("auth", {"step": "login", "result": "fail_pin", "name": "Mia"}) == {
        "step": "login",
        "result": "fail_pin",
    }
    for s in ("login", "register", "join", "reset_pin", "forgot_pin"):
        assert events.clean("auth", {"step": s, "result": "ok"}) is not None
    for r in ("ok", "fail_pin", "fail_code", "locked", "error"):
        assert events.clean("auth", {"step": "join", "result": r}) is not None
    assert events.clean("auth", {"step": "x", "result": "ok"}) is None
    assert events.clean("auth", {"step": "login", "result": "mia@x.com"}) is None
    assert events.clean("auth", {"step": "login"}) is None


def test_clean_game():
    props = {"id": "hungry-cat", "result": "finish", "duration_bucket": "1-2m"}
    props["score_bucket"] = "10-49"
    assert events.clean("game", {**props, "kid_id": 3, "name": "Mia"}) == props
    assert events.clean("game", {"id": "hungry-cat", "result": "start"}) == {
        "id": "hungry-cat",
        "result": "start",
    }
    assert events.clean("game", {**props, "id": "Mia's game"}) is None
    assert events.clean("game", {**props, "result": "won"}) is None
    assert events.clean("game", {**props, "score_bucket": 37}) is None
    assert events.clean("game", {**props, "duration_bucket": "93s"}) is None


def test_game_ids_match_catalog():
    from app.services.games_catalog import GAMES

    assert set(GAMES) == events.GAME_IDS


def test_clean_setup_detail():
    for what in (
        "devices_found_0", "devices_found_4_9", "rescan", "name_edited", "preset_strict",
        "preset_mixed", "chores_kept_100", "chores_kept_lt50", "wifi_changed",
    ):  # fmt: skip
        assert events.clean("setup_detail", {"step": 3, "what": what}) == {"step": 3, "what": what}
    assert events.clean("setup_detail", {"step": 3, "what": "devices_found_12"}) is None
    assert events.clean("setup_detail", {"step": 3, "what": "MyHomeWifi"}) is None
    assert events.clean("setup_detail", {"step": 9, "what": "rescan"}) is None
    assert events.clean("setup_detail", {"step": True, "what": "rescan"}) is None
