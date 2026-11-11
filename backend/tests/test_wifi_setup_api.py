"""Unit tests for setup-mode Wi-Fi API (hotspot join endpoint security)."""

import pytest
from fastapi.testclient import TestClient

from app.main import fastapi_app
from app.services import network_wifi


client = TestClient(fastapi_app)


class TestSetupJoinSecurity:
    """Tests for /api/v1/network/wifi/setup/join endpoint security."""

    def test_setup_join_missing_token_403(self, monkeypatch):
        """SECURITY: Reject request without X-Edge-Token."""
        def mock_call_helper(cmd, **kwargs):
            if cmd == "status":
                return {"connected": False, "ssid": None, "signal": 0, "hotspot_active": True}
            return {}

        monkeypatch.setattr(network_wifi, "_call_helper", mock_call_helper)

        # Hotspot IP without token
        response = client.post(
            "/api/v1/network/wifi/setup/join",
            json={"ssid": "TestNet", "password": "password123"},
            headers={"X-Real-IP": "10.42.0.5"}
        )
        assert response.status_code == 403
        assert "X-Edge-Token" in response.json()["detail"]

    def test_setup_join_spoofed_xip_from_lan_403(self, monkeypatch):
        """SECURITY: Reject LAN client spoofing 10.42.0.x with valid token."""
        def mock_call_helper(cmd, **kwargs):
            if cmd == "status":
                return {"connected": False, "ssid": None, "signal": 0, "hotspot_active": True}
            return {}

        monkeypatch.setattr(network_wifi, "_call_helper", mock_call_helper)

        # LAN client (192.168.1.x) with valid token but wrong IP
        response = client.post(
            "/api/v1/network/wifi/setup/join",
            json={"ssid": "TestNet", "password": "password123"},
            headers={
                "X-Real-IP": "10.42.0.5",
                "X-Edge-Token": "valid_token"
            },
            client=("192.168.1.100", 12345)  # Real socket peer is LAN
        )
        assert response.status_code == 403
        assert "hotspot subnet" in response.json()["detail"]

    def test_setup_join_setup_mode_off_503(self, monkeypatch):
        """SECURITY: Reject join when setup mode (hotspot) is not active."""
        def mock_call_helper(cmd, **kwargs):
            if cmd == "status":
                return {"connected": False, "ssid": None, "signal": 0, "hotspot_active": False}
            return {}

        monkeypatch.setattr(network_wifi, "_call_helper", mock_call_helper)

        response = client.post(
            "/api/v1/network/wifi/setup/join",
            json={"ssid": "TestNet", "password": "password123"},
            headers={
                "X-Edge-Token": "valid_token",
                "X-Real-IP": "10.42.0.5"
            },
            client=("10.42.0.5", 12345)  # Direct hotspot connection
        )
        assert response.status_code == 503
        assert "Setup mode not active" in response.json()["detail"]

    def test_setup_join_valid_hotspot_200(self, monkeypatch):
        """Valid hotspot client with token and setup mode active → join succeeds."""
        def mock_call_helper(cmd, **kwargs):
            if cmd == "status":
                return {"connected": False, "ssid": None, "signal": 0, "hotspot_active": True}
            elif cmd == "join":
                return {"success": True}
            return {}

        monkeypatch.setattr(network_wifi, "_call_helper", mock_call_helper)

        response = client.post(
            "/api/v1/network/wifi/setup/join",
            json={"ssid": "TestNet", "password": "password123"},
            headers={
                "X-Edge-Token": "valid_token",
                "X-Real-IP": "10.42.0.5"
            },
            client=("10.42.0.5", 12345)
        )
        assert response.status_code == 200
        assert response.json()["status"] == "connected"

    def test_setup_join_rejects_newline_in_ssid(self, monkeypatch):
        """SECURITY: Reject SSID with newline (caught by validation in join)."""
        def mock_call_helper(cmd, **kwargs):
            if cmd == "status":
                return {"connected": False, "ssid": None, "signal": 0, "hotspot_active": True}
            return {}

        monkeypatch.setattr(network_wifi, "_call_helper", mock_call_helper)

        response = client.post(
            "/api/v1/network/wifi/setup/join",
            json={"ssid": "Test\nNet", "password": "password123"},
            headers={
                "X-Edge-Token": "valid_token",
                "X-Real-IP": "10.42.0.5"
            },
            client=("10.42.0.5", 12345)
        )
        assert response.status_code == 400
        assert "control characters" in response.json()["detail"]

    def test_setup_join_rejects_newline_in_password(self, monkeypatch):
        """SECURITY: Reject password with newline (caught by validation in join)."""
        def mock_call_helper(cmd, **kwargs):
            if cmd == "status":
                return {"connected": False, "ssid": None, "signal": 0, "hotspot_active": True}
            return {}

        monkeypatch.setattr(network_wifi, "_call_helper", mock_call_helper)

        response = client.post(
            "/api/v1/network/wifi/setup/join",
            json={"ssid": "TestNet", "password": "password\n123"},
            headers={
                "X-Edge-Token": "valid_token",
                "X-Real-IP": "10.42.0.5"
            },
            client=("10.42.0.5", 12345)
        )
        assert response.status_code == 400
        assert "control characters" in response.json()["detail"]
