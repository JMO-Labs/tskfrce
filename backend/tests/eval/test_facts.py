import pytest
from app.eval import facts

G = 1024**3


@pytest.mark.parametrize(
    "b,want",
    [
        (None, "unknown"),
        (0, "unknown"),
        (2 * G, "<=2G"),
        (2 * G + 1, "4G"),
        (4 * G, "4G"),
        (4 * G + 1, "8G"),
        (8 * G, "8G"),
        (8 * G + 1, ">8G"),
    ],
)
def test_ram_class(b, want):
    assert facts.ram_class(b) == want


@pytest.mark.parametrize(
    "s,want",
    [
        (None, "unknown"),
        (3599, "<1h"),
        (3600, "1h-1d"),
        (86399, "1h-1d"),
        (86400, "1d-7d"),
        (7 * 86400 - 1, "1d-7d"),
        (7 * 86400, "7d-30d"),
        (30 * 86400, ">30d"),
    ],
)
def test_uptime_bucket(s, want):
    assert facts.uptime_bucket(s) == want


@pytest.mark.parametrize("n,want", [(None, 0), (0, 0), (1, 1), (64, 64), (65, 64)])
def test_cores(n, want):
    assert facts.cores(n) == want


@pytest.mark.parametrize(
    "m,want", [("x86_64", "x86_64"), ("aarch64", "arm64"), ("arm64", "arm64"),
               ("armv7l", "arm"), ("riscv64", "other"), ("", "unknown"), (None, "unknown")]
)  # fmt: skip
def test_arch(m, want):
    assert facts.arch(m) == want


@pytest.mark.parametrize(
    "st,want",
    [
        (None, ("unknown", 0)),
        ({}, ("unknown", 0)),
        ({"connected": True, "online": True}, ("wifi", 1)),
        ({"connected": False, "online": True}, ("wired", 1)),
        ({"connected": False, "online": False}, ("unknown", 0)),
        ({"connected": True, "wired": True}, ("both", 2)),
        ({"connected": False, "wired": True}, ("wired", 1)),
        ({"connected": True, "wired": False}, ("wifi", 1)),
    ],
)
def test_net(st, want):
    assert facts.net(st) == want


def test_net_never_leaks_names():
    out = facts.net({"connected": True, "ssid": "HomeNet", "online": True})
    assert "HomeNet" not in str(out)


def test_update_facts(monkeypatch):
    from app.api import updates

    monkeypatch.setattr(
        updates, "_read_state", lambda: {"channel": "eval", "last_result": "failed"}
    )
    assert facts.update() == ("eval", "failed")
    monkeypatch.setattr(updates, "_read_state", lambda: {"channel": "x\ny", "last_result": "?"})
    assert facts.update() == ("unknown", "unknown")
    monkeypatch.setattr(updates, "_read_state", lambda: {"channel": "stable", "last_result": None})
    assert facts.update() == ("stable", "unknown")


def test_update_facts_error(monkeypatch):
    from app.api import updates

    def boom():
        raise OSError

    monkeypatch.setattr(updates, "_read_state", boom)
    assert facts.update() == ("unknown", "unknown")


def test_collect_missing_everything(monkeypatch):
    monkeypatch.setattr(facts, "_ram_bytes", lambda: None)
    monkeypatch.setattr(facts, "_uptime", lambda: None)
    monkeypatch.setattr(facts, "_netd", lambda: None)
    monkeypatch.setattr(facts.os, "cpu_count", lambda: None)
    monkeypatch.setattr(facts.platform, "machine", lambda: "")
    out = facts.collect()
    assert set(out) == set(facts.KEYS)
    assert out["ram_class"] == out["uptime_bucket"] == out["arch"] == "unknown"
    assert out["net_mode"] == "unknown" and out["network_count"] == 0


def test_netd_down_is_none(monkeypatch):
    from app.services import network_wifi

    def boom():
        raise RuntimeError

    monkeypatch.setattr(network_wifi, "status", boom)
    assert facts._netd() is None
