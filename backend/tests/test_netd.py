"""Host network daemon (scripts/tskfrce-netd.py): validation, secrets out of argv, keyfile safety."""

import importlib.util
import os
import stat
from pathlib import Path
from types import SimpleNamespace

import pytest

SRC = Path(__file__).resolve().parents[2] / "scripts" / "tskfrce-netd.py"
spec = importlib.util.spec_from_file_location("netd", SRC)
assert spec and spec.loader
netd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(netd)

PSK = "hunter2-secret"


@pytest.fixture
def nmcli(monkeypatch, tmp_path):
    """Fake nmcli: records argv, one wifi device, nothing active unless told."""
    calls, state = [], {"up_rc": 0, "stderr": "", "active": []}

    def run(argv, **kw):
        calls.append(argv)
        args = argv[1:]
        out = ""
        if args[:4] == ["-t", "-f", "DEVICE,TYPE", "device"]:
            out = "wlo1:wifi\neno2:ethernet\n"
        elif "--active" in args:
            out = "".join(f"{n}:{t}:{d}\n" for n, t, d in state["active"])
        rc = state["up_rc"] if "up" in args else 0
        return SimpleNamespace(
            returncode=rc, stdout=out, stderr=state["stderr"] if "up" in args else ""
        )

    monkeypatch.setattr(netd.subprocess, "run", run)
    monkeypatch.setattr(netd, "KEYFILES", tmp_path)
    monkeypatch.setattr(netd, "STATE", tmp_path / "state")
    monkeypatch.setattr(netd, "COUNTRY_FILE", tmp_path / "state" / "country")
    monkeypatch.setattr(netd, "EDGE_COUNTRY", tmp_path / "edge-country")
    monkeypatch.setattr(netd, "CAPTIVE_DNS", tmp_path / "captive.conf")
    return SimpleNamespace(calls=calls, state=state, dir=tmp_path)


@pytest.mark.parametrize("ssid", ["", "x" * 33, "a\nb", "a\x00", "evil\r[ipv4]", 5, None])
def test_bad_ssid_rejected(ssid):
    assert not netd.valid_ssid(ssid)


@pytest.mark.parametrize("psk", ["short", "x" * 65, "has\nnewline12", "g" * 64, None])
def test_bad_psk_rejected(psk):
    assert not netd.valid_psk(psk)


def test_good_values_accepted():
    assert netd.valid_ssid("Home WiFi; 5G") and netd.valid_psk(PSK) and netd.valid_psk("ab" * 32)
    assert netd.valid_cc("US") and not netd.valid_cc("us") and not netd.valid_cc("USA")


def test_handle_rejects_injection_before_nmcli(nmcli):
    assert netd.handle({"cmd": "join", "ssid": "x\n[ipv4]", "password": PSK}) == {
        "error": "bad_ssid"
    }
    assert netd.handle({"cmd": "join", "ssid": "Home", "password": "p\nsk=evil1"}) == {
        "error": "bad_password"
    }
    assert nmcli.calls == []


def test_join_keeps_secret_out_of_argv_and_writes_0600_keyfile(nmcli):
    assert netd.handle({"cmd": "join", "ssid": "Home", "password": PSK}) == {"success": True}
    assert not any(PSK in " ".join(c) for c in nmcli.calls)
    kf = nmcli.dir / f"{netd.wifi_name('Home')}.nmconnection"
    assert stat.S_IMODE(kf.stat().st_mode) == 0o600
    assert f"psk={PSK}" in kf.read_text() and "ssid=Home" in kf.read_text()


def test_ssid_never_used_as_connection_name(nmcli):
    netd.handle({"cmd": "join", "ssid": "--help", "password": PSK})
    assert not any("--help" in c for c in nmcli.calls)


def test_failed_join_deletes_profile_and_rolls_back(nmcli):
    nmcli.state.update(
        up_rc=4,
        stderr="Secrets were required, but not provided",
        active=[("OldNet", "802-11-wireless", "wlo1")],
    )
    res = netd.handle({"cmd": "join", "ssid": "Home", "password": PSK})
    assert res == {"success": False, "error": "wrong_password"}
    assert not (nmcli.dir / f"{netd.wifi_name('Home')}.nmconnection").exists()
    assert ["nmcli", "--wait", "60", "connection", "up", "id", "OldNet"] in nmcli.calls


def test_keyfile_escapes_backslash_and_leading_space():
    assert netd.kf_escape(" a\\b") == "\\sa\\\\b"


def test_setup_join_refused_outside_setup_mode(nmcli):
    assert netd.handle({"cmd": "setup_join", "ssid": "Home", "password": PSK}) == {
        "error": "not_in_setup_mode"
    }


def test_country_validated_and_persisted(nmcli):
    assert netd.handle({"cmd": "set_country", "country": "u;s"})["success"] is False
    assert netd.handle({"cmd": "set_country", "country": "DE"}) == {
        "success": True,
        "country": "DE",
    }
    assert ["iw", "reg", "set", "DE"] in nmcli.calls
    assert netd.COUNTRY_FILE.read_text() == "DE"


def test_country_defaults_to_us_and_prefers_edge(nmcli):
    assert netd.apply_country()["country"] == "US"
    netd.EDGE_COUNTRY.write_text("CA\n")
    assert netd.apply_country()["country"] == "CA"


def test_terse_split_handles_escaped_colons():
    assert netd.terse(r"My\:Net:WPA2:70") == ["My:Net", "WPA2", "70"]


def test_unknown_command(nmcli):
    assert netd.handle({"cmd": "rm -rf"}) == {"error": "unknown_command"}


def test_hotspot_installs_antispoof_and_captive_then_removes(nmcli, monkeypatch, tmp_path):
    creds = tmp_path / "setup.json"
    creds.write_text('{"ssid": "t@sk4ce-k7m2", "password": "sticker-pass"}')
    monkeypatch.setattr(netd, "SETUP_CREDS", creds)
    started = []
    monkeypatch.setattr(netd, "captive_start", lambda: started.append(1))
    assert netd.hotspot_up() == {"success": True}
    nft = [c for c in nmcli.calls if c[0] == "nft"]
    assert nft and nft[0][:3] == ["nft", "-f", "-"] and started == [1]
    assert netd.CAPTIVE_DNS.read_text() == "address=/#/10.42.0.1\n"
    assert not any("sticker-pass" in " ".join(c) for c in nmcli.calls)
    netd.hotspot_down()
    assert ["nft", "delete", "table", "inet", "tskfrce_netd"] in nmcli.calls
    assert not netd.CAPTIVE_DNS.exists()


def test_no_antispoof_rule_means_no_hotspot(nmcli, monkeypatch, tmp_path):
    creds = tmp_path / "setup.json"
    creds.write_text('{"ssid": "t@sk4ce-k7m2", "password": "sticker-pass"}')
    monkeypatch.setattr(netd, "SETUP_CREDS", creds)
    monkeypatch.setattr(netd, "antispoof", lambda dev: False)
    assert netd.hotspot_up() == {"success": False, "error": "antispoof_failed"}
    assert not any("up" in c for c in nmcli.calls if c[0] == "nmcli")


def _kf(nmcli, ssid):
    return (nmcli.dir / f"{netd.wifi_name(ssid)}.nmconnection").read_text()


def test_open_network_has_no_security_section(nmcli):
    assert netd.handle({"cmd": "join", "ssid": "Cafe", "password": "ignored!", "security": "open"})[
        "success"
    ]
    kf = _kf(nmcli, "Cafe")
    assert "[wifi-security]" not in kf and "psk=" not in kf


def test_wpa3_only_and_hidden(nmcli):
    netd.handle(
        {"cmd": "join", "ssid": "Attic", "password": PSK, "security": "sae", "hidden": True}
    )
    kf = _kf(nmcli, "Attic")
    assert "key-mgmt=sae" in kf and "hidden=true" in kf


@pytest.mark.parametrize("bad", [{"security": "wep"}, {"security": "wpa", "hidden": "yes"}])
def test_bad_security_options_rejected(nmcli, bad):
    req = {"cmd": "join", "ssid": "Home", "password": PSK, **bad}
    assert netd.handle(req) == {"error": "bad_security"} and nmcli.calls == []


def test_read_small_refuses_symlink_fifo_and_reads_8_bytes(tmp_path):
    secret = tmp_path / "shadow"
    secret.write_text("root:secret-hash")
    link = tmp_path / "country"
    link.symlink_to(secret)
    assert netd.read_small(link) is None
    fifo = tmp_path / "fifo"
    os.mkfifo(fifo)
    assert netd.read_small(fifo) is None  # returns at once, no hang
    big = tmp_path / "big"
    big.write_text("DE" + "x" * 10_000)
    assert netd.read_small(big) == "DExxxxxx"


def test_online_follows_kernel_default_route_not_nm(nmcli, monkeypatch):
    """A networkd-managed wired link (NM 'unmanaged') still counts as online."""
    real = netd.subprocess.run

    def run(argv, **kw):
        if argv[:3] == ["ip", "-j", "-4"]:
            return SimpleNamespace(returncode=0, stdout=nmcli.state.get("routes", "[]"), stderr="")
        return real(argv, **kw)

    monkeypatch.setattr(netd.subprocess, "run", run)
    assert netd.online() is False
    nmcli.state["routes"] = '[{"dst": "default", "gateway": "192.168.1.1", "dev": "eno2"}]'
    assert netd.online() is True
    nmcli.state["routes"] = '[{"dst": "default", "dev": "wlo1"}]'
    nmcli.state["active"] = [("tskfrce-setup", "802-11-wireless", "wlo1")]
    assert netd.online() is False  # only the hotspot itself
