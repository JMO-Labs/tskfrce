import pytest
from blocker.state_store import MAC_RE, StateStore


def test_mac_re_matches_app_pattern():
    assert MAC_RE.pattern == r"^([0-9a-f]{2}:){5}[0-9a-f]{2}$"


def test_set_blocked_normalizes_and_dedupes():
    s = StateStore()
    out = s.set_blocked(["AA:BB:CC:DD:EE:FF", "aa:bb:cc:dd:ee:ff", "11:22:33:44:55:66"])
    assert out == {"aa:bb:cc:dd:ee:ff", "11:22:33:44:55:66"}
    assert s.current() == out


def test_set_blocked_rejects_bad_mac_keeps_old():
    s = StateStore()
    s.set_blocked(["aa:bb:cc:dd:ee:ff"])
    with pytest.raises(ValueError):
        s.set_blocked(["11:22:33:44:55:66", "aa:xx"])
    assert s.current() == {"aa:bb:cc:dd:ee:ff"}


def test_on_change_fires_with_new_set():
    s = StateStore()
    seen = []
    s.on_change(seen.append)
    s.set_blocked(["AA:BB:CC:DD:EE:FF"])
    with pytest.raises(ValueError):
        s.set_blocked(["bad"])
    assert seen == [{"aa:bb:cc:dd:ee:ff"}]


def test_failing_callback_does_not_skip_others():
    s = StateStore()
    seen = []

    def boom(_):
        raise RuntimeError("x")

    s.on_change(boom)
    s.on_change(seen.append)
    assert s.set_blocked(["aa:bb:cc:dd:ee:ff"]) == {"aa:bb:cc:dd:ee:ff"}
    assert seen == [{"aa:bb:cc:dd:ee:ff"}]


HW_MAC = "aa:bb:cc:dd:ee:01"


def _hw(**over):
    hw = {"allow": [" Khan.ORG. "], "block": ["YouTube.com"], "until": "2099-01-01T00:00:00Z"}
    hw.update(over)
    return {HW_MAC.upper(): hw}


def test_set_state_normalizes_homework_lists():
    s = StateStore()
    s.set_state([], _hw(allow=[" Khan.ORG. ", "khan.org"]))
    assert s.homework() == {
        HW_MAC: {"allow": ["khan.org"], "block": ["youtube.com"], "until": "2099-01-01T00:00:00Z"}
    }


@pytest.mark.parametrize(
    "bad",
    [
        {"allow": ["ok.com", ""]},
        {"allow": ["ok.com", "  . "]},
        {"block": [None]},
        {"block": [123]},
        {"allow": "khan.org"},
        {"until": "tomorrow"},
        {"until": "2099-01-01T00:00:00"},  # no timezone
        {"until": None},
        {"allow": ["a.com"] * 1001},
    ],
)
def test_set_state_rejects_bad_homework_keeps_old(bad):
    s = StateStore()
    s.set_state(["aa:bb:cc:dd:ee:ff"], _hw())
    before = s.homework()
    with pytest.raises(ValueError):
        s.set_state([], _hw(**bad))
    assert s.homework() == before
    assert s.current() == {"aa:bb:cc:dd:ee:ff"}
