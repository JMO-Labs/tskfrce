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


def _net(db, iface, days=0):
    from datetime import datetime, timedelta

    from app.models.network import Network

    db.add(
        Network(
            iface=iface,
            subnet=f"10.0.{len(iface)}.0/24",
            auto_label="SecretLabel",
            last_seen=datetime.utcnow() - timedelta(days=days),
        )
    )
    db.commit()


def test_net_wired(db):
    _net(db, "eno2")
    assert facts.net(db, None) == ("wired", 1)


def test_net_wifi(db):
    _net(db, "wlo1")
    assert facts.net(db, None) == ("wifi", 1)


def test_net_both(db):
    _net(db, "eno2")
    _net(db, "wlo1")
    assert facts.net(db, None) == ("both", 2)


def test_net_stale_excluded(db):
    _net(db, "eno2")
    _net(db, "wlo1", days=8)
    assert facts.net(db, None) == ("wired", 1)


def test_net_no_rows_unknown(db):
    assert facts.net(db, None) == ("unknown", 0)
    assert facts.net(db, {}) == ("unknown", 0)


@pytest.mark.parametrize(
    "st,want",
    [
        ({"connected": True}, ("wifi", 1)),
        ({"connected": False, "online": True}, ("wired", 1)),
        ({"connected": False, "online": False}, ("unknown", 0)),
    ],
)
def test_net_netd_fallback(db, st, want):
    assert facts.net(db, st) == want


def test_net_never_leaks_names(db):
    _net(db, "wlo1")
    out = facts.net(db, {"connected": True, "ssid": "HomeNet"})
    assert "SecretLabel" not in str(out) and "wlo1" not in str(out)


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


def test_collect_missing_everything(monkeypatch, db):
    monkeypatch.setattr(facts, "_ram_bytes", lambda: None)
    monkeypatch.setattr(facts, "_uptime", lambda: None)
    monkeypatch.setattr(facts, "_netd", lambda: None)
    monkeypatch.setattr(facts.os, "cpu_count", lambda: None)
    monkeypatch.setattr(facts.platform, "machine", lambda: "")
    out = facts.collect(db)
    assert set(out) == set(facts.KEYS)
    assert out["ram_class"] == out["uptime_bucket"] == out["arch"] == "unknown"
    assert out["net_mode"] == "unknown" and out["network_count"] == 0


def test_netd_down_is_none(monkeypatch):
    from app.services import network_wifi

    def boom():
        raise RuntimeError

    monkeypatch.setattr(network_wifi, "status", boom)
    assert facts._netd() is None
