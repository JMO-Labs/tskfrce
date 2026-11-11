"""Unit tests for network_wifi service with mocked nmcli."""

import pytest
from app.services import network_wifi
from app.services.network_wifi import (
    _validate_password,
    _validate_ssid,
    forget,
    join,
    scan,
)


class TestValidation:
    def test_valid_ssid(self):
        _validate_ssid("MyNetwork")  # Should not raise

    def test_ssid_too_long(self):
        long_ssid = "a" * 33
        with pytest.raises(ValueError, match="Invalid SSID"):
            _validate_ssid(long_ssid)

    def test_ssid_empty(self):
        with pytest.raises(ValueError, match="Invalid SSID"):
            _validate_ssid("")

    def test_ssid_null_byte(self):
        with pytest.raises(ValueError, match="contains null"):
            _validate_ssid("test\x00net")

    def test_valid_password(self):
        _validate_password("password123")  # Should not raise

    def test_password_too_short(self):
        with pytest.raises(ValueError, match="8-64 bytes"):
            _validate_password("short")

    def test_password_too_long(self):
        long_pass = "a" * 65
        with pytest.raises(ValueError, match="8-64 bytes"):
            _validate_password(long_pass)


class TestScan:
    def test_scan_calls_nmcli(self, monkeypatch):
        """Mock nmcli and verify scan parses output."""

        def mock_check_output(cmd, **kwargs):
            assert cmd[0:3] == ["fake_nmcli", "dev", "wifi"]
            return (
                "SSID            SECURITY SIGNAL\n"
                "MyNet           WPA2     80\n"
                "OtherNet        WPA      60\n"
            )

        monkeypatch.setattr("subprocess.check_output", mock_check_output)
        networks = scan(nmcli_exe="fake_nmcli")
        assert len(networks) == 2
        assert networks[0].ssid == "MyNet"
        assert networks[0].signal == 80
        assert networks[1].signal == 60  # Sorted by signal

    def test_scan_empty(self, monkeypatch):
        """Scan with no networks."""

        def mock_check_output(cmd, **kwargs):
            return "SSID            SECURITY SIGNAL\n"

        monkeypatch.setattr("subprocess.check_output", mock_check_output)
        networks = scan(nmcli_exe="fake_nmcli")
        assert networks == []


class TestJoin:
    def test_join_success(self, monkeypatch):
        """Successful join returns True."""

        def mock_run(cmd, **kwargs):
            assert cmd[0:3] == ["fake_nmcli", "dev", "wifi"]
            assert "connect" in cmd
            assert "MyNet" in cmd

        monkeypatch.setattr("subprocess.run", mock_run)
        result = join("MyNet", "password123", nmcli_exe="fake_nmcli")
        assert result is True

    def test_join_validates_ssid(self):
        """Join rejects invalid SSID before calling nmcli."""
        with pytest.raises(ValueError):
            join("", "password123")

    def test_join_validates_password(self):
        """Join rejects invalid password before calling nmcli."""
        with pytest.raises(ValueError):
            join("MyNet", "short")

    def test_join_failure(self, monkeypatch):
        """Failed nmcli call returns False."""

        def mock_run(cmd, **kwargs):
            raise Exception("nmcli failed")

        monkeypatch.setattr("subprocess.run", mock_run)
        result = join("MyNet", "password123", nmcli_exe="fake_nmcli")
        assert result is False


class TestForget:
    def test_forget_validates_ssid(self):
        """Forget rejects invalid SSID."""
        with pytest.raises(ValueError):
            forget("")

    def test_forget_success(self, monkeypatch):
        """Successful forget returns True."""

        def mock_run(cmd, **kwargs):
            assert "connection" in cmd
            assert "delete" in cmd

        monkeypatch.setattr("subprocess.run", mock_run)
        result = forget("MyNet", nmcli_exe="fake_nmcli")
        assert result is True


class TestStatus:
    def test_status_connected(self, monkeypatch):
        """Status when connected."""

        def mock_check_output(cmd, **kwargs):
            return "wlan0:connected\nlo:unmanaged\n"

        monkeypatch.setattr("subprocess.check_output", mock_check_output)
        status_dict = network_wifi.status(nmcli_exe="fake_nmcli")
        assert status_dict["connected"] is True

    def test_status_disconnected(self, monkeypatch):
        """Status when not connected."""

        def mock_check_output(cmd, **kwargs):
            return "wlan0:disconnected\n"

        monkeypatch.setattr("subprocess.check_output", mock_check_output)
        status_dict = network_wifi.status(nmcli_exe="fake_nmcli")
        assert status_dict["connected"] is False
