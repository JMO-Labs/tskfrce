"""Setup mode: hotspot management and watchdog for saved Wi-Fi."""

from datetime import datetime

from app.services import network_wifi


class SetupModeManager:
    """Manage setup mode hotspot and 5-minute Wi-Fi watchdog."""

    def __init__(self, box_id: str, setup_password: str):
        self.box_id = box_id
        self.setup_password = setup_password
        self.hotspot_ssid = f"t@sk4ce-{box_id[:4]}"
        self.last_online = datetime.now()
        self.in_setup_mode = False

    def check_need_setup_mode(self) -> bool:
        """Return True if setup mode should be active."""
        status = network_wifi.status()
        # Setup mode if: no current connection, or saved Wi-Fi unreachable
        if status["connected"]:
            self.last_online = datetime.now()
            return False
        # Check if unreachable for 5 minutes
        elapsed = (datetime.now() - self.last_online).total_seconds()
        return elapsed > 300  # 5 minutes

    def enable_setup_mode(self, country: str = "US") -> bool:
        """Start setup hotspot."""
        try:
            success = network_wifi.hotspot_up(self.hotspot_ssid, self.setup_password, country)
            if success:
                self.in_setup_mode = True
                # TODO: Start nftables DNS spoofing and captive portal
                return True
            return False
        except Exception:
            return False

    def disable_setup_mode(self) -> bool:
        """Stop setup hotspot."""
        try:
            success = network_wifi.hotspot_down()
            if success:
                self.in_setup_mode = False
                # TODO: Stop captive portal
                return True
            return False
        except Exception:
            return False

    def process_join_request(self, ssid: str, password: str) -> bool:
        """Attempt to join, with 60s rollback if fails."""
        # Get current connection to rollback to
        status_before = network_wifi.status()

        # Try to join (hotspot stays up)
        if not network_wifi.join(ssid, password, timeout=60):
            # Join failed, hotspot drops if concurrent mode not supported
            # Bring hotspot back up
            network_wifi.hotspot_up(self.hotspot_ssid, self.setup_password)
            return False

        # Join succeeded, save it as successful
        self.last_online = datetime.now()
        return True

    def process_settings_join(self, ssid: str, password: str) -> bool:
        """Join from Settings with 60s rollback to previous network."""
        status_before = network_wifi.status()
        prev_ssid = status_before.get("ssid")

        # Try to join
        if not network_wifi.join(ssid, password, timeout=60):
            # Join failed, stay on previous
            if prev_ssid:
                network_wifi.join(prev_ssid, "")  # Try to rejoin previous
            return False

        # Join succeeded
        self.last_online = datetime.now()
        return True
