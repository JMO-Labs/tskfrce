"""Unit tests for network_wifi service (socket-based helper client)."""

import pytest
from app.services import network_wifi


class TestValidation:
    def test_valid_ssid(self):
        network_wifi._validate_ssid("MyNetwork")  # Should not raise

    def test_ssid_too_long(self):
        long_ssid = "a" * 33
        with pytest.raises(ValueError, match="Invalid SSID"):
            network_wifi._validate_ssid(long_ssid)

    def test_ssid_empty(self):
        with pytest.raises(ValueError, match="Invalid SSID"):
            network_wifi._validate_ssid("")

    def test_ssid_null_byte(self):
        """Null byte is a control character, rejected."""
        with pytest.raises(ValueError, match="control characters"):
            network_wifi._validate_ssid("test\x00net")

    def test_ssid_newline_injection(self):
        """SECURITY: Reject newline in SSID (keyfile injection attack)."""
        with pytest.raises(ValueError, match="control characters"):
            network_wifi._validate_ssid("test\nnetwork")

    def test_ssid_control_chars(self):
        """SECURITY: Reject all control characters (0x00-0x1f, 0x7f)."""
        with pytest.raises(ValueError, match="control characters"):
            network_wifi._validate_ssid("test\x1fnet")
        with pytest.raises(ValueError, match="control characters"):
            network_wifi._validate_ssid("test\x7fnet")

    def test_valid_password(self):
        network_wifi._validate_password("password123")  # Should not raise

    def test_valid_password_hex_64(self):
        """64-byte password must be hex."""
        hex_64 = "a" * 64
        network_wifi._validate_password(hex_64)  # Should not raise

    def test_password_too_short(self):
        with pytest.raises(ValueError, match="8-63 or 64 bytes"):
            network_wifi._validate_password("short")

    def test_password_too_long(self):
        long_pass = "a" * 65
        with pytest.raises(ValueError, match="8-63 or 64 bytes"):
            network_wifi._validate_password(long_pass)

    def test_password_newline_injection(self):
        """SECURITY: Reject newline in password (keyfile injection attack)."""
        with pytest.raises(ValueError, match="control characters"):
            network_wifi._validate_password("password\n123")

    def test_password_control_chars(self):
        """SECURITY: Reject control characters in password."""
        with pytest.raises(ValueError, match="control characters"):
            network_wifi._validate_password("password\x1f123")
        with pytest.raises(ValueError, match="control characters"):
            network_wifi._validate_password("password\x7f123")

    def test_password_64_non_hex(self):
        """64-byte password must be hex (lowercase, uppercase, or digits)."""
        non_hex_64 = "z" * 64
        with pytest.raises(ValueError, match="hex-encoded"):
            network_wifi._validate_password(non_hex_64)


class TestCountryValidation:
    def test_invalid_country_too_long(self):
        with pytest.raises(ValueError):
            network_wifi.set_country("USA")

    def test_invalid_country_digits(self):
        with pytest.raises(ValueError):
            network_wifi.set_country("U1")


class TestScan:
    def test_scan_calls_helper(self, monkeypatch):
        """Mock socket and verify scan parses response."""

        def mock_call_helper(cmd, **kwargs):
            assert cmd == "scan"
            return {
                "networks": [
                    {"ssid": "MyNet", "signal": 80, "security": "WPA2"},
                    {"ssid": "OtherNet", "signal": 60, "security": "WPA2"},
                ]
            }

        monkeypatch.setattr(network_wifi, "_call_helper", mock_call_helper)
        networks = network_wifi.scan()
        assert len(networks) == 2
        assert networks[0].ssid == "MyNet"
        assert networks[0].signal == 80


class TestJoin:
    def test_join_validates_ssid(self):
        """Join rejects invalid SSID before calling helper."""
        with pytest.raises(ValueError):
            network_wifi.join("", "password123")

    def test_join_validates_password(self):
        """Join rejects invalid password before calling helper."""
        with pytest.raises(ValueError):
            network_wifi.join("MyNet", "short")

    def test_join_success(self, monkeypatch):
        """Successful join returns True (password NOT in argv)."""

        def mock_call_helper(cmd, **kwargs):
            assert cmd == "join"
            assert kwargs["ssid"] == "MyNet"
            assert kwargs["password"] == "password123"
            # Socket-based: password is in JSON, not shell argv
            return {"success": True}

        monkeypatch.setattr(network_wifi, "_call_helper", mock_call_helper)
        result = network_wifi.join("MyNet", "password123")
        assert result is True

    def test_join_failure(self, monkeypatch):
        """Failed join returns False."""

        def mock_call_helper(cmd, **kwargs):
            return {"success": False}

        monkeypatch.setattr(network_wifi, "_call_helper", mock_call_helper)
        result = network_wifi.join("MyNet", "password123")
        assert result is False


class TestForget:
    def test_forget_validates_ssid(self):
        """Forget rejects invalid SSID."""
        with pytest.raises(ValueError):
            network_wifi.forget("")

    def test_forget_success(self, monkeypatch):
        """Successful forget returns True."""

        def mock_call_helper(cmd, **kwargs):
            assert cmd == "forget"
            assert kwargs["ssid"] == "MyNet"
            return {"success": True}

        monkeypatch.setattr(network_wifi, "_call_helper", mock_call_helper)
        result = network_wifi.forget("MyNet")
        assert result is True


class TestStatus:
    def test_status_connected(self, monkeypatch):
        """Status when connected."""

        def mock_call_helper(cmd, **kwargs):
            return {"connected": True, "ssid": "MyNet", "signal": 75}

        monkeypatch.setattr(network_wifi, "_call_helper", mock_call_helper)
        status_dict = network_wifi.status()
        assert status_dict["connected"] is True
        assert status_dict["ssid"] == "MyNet"

    def test_status_disconnected(self, monkeypatch):
        """Status when not connected."""

        def mock_call_helper(cmd, **kwargs):
            return {"connected": False, "ssid": None, "signal": 0}

        monkeypatch.setattr(network_wifi, "_call_helper", mock_call_helper)
        status_dict = network_wifi.status()
        assert status_dict["connected"] is False


class TestHotspot:
    def test_hotspot_up_success(self, monkeypatch):
        """Start hotspot."""

        def mock_call_helper(cmd, **kwargs):
            assert cmd == "hotspot_up"
            assert kwargs["ssid"] == "t@sk4ce-abcd"
            assert kwargs["password"] == "password123"
            assert kwargs["country"] == "US"
            return {"success": True}

        monkeypatch.setattr(network_wifi, "_call_helper", mock_call_helper)
        result = network_wifi.hotspot_up("t@sk4ce-abcd", "password123", "US")
        assert result is True

    def test_hotspot_down_success(self, monkeypatch):
        """Stop hotspot."""

        def mock_call_helper(cmd, **kwargs):
            assert cmd == "hotspot_down"
            return {"success": True}

        monkeypatch.setattr(network_wifi, "_call_helper", mock_call_helper)
        result = network_wifi.hotspot_down()
        assert result is True
