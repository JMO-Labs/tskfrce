"""Wi-Fi network management via nmcli."""

import subprocess
from dataclasses import dataclass


@dataclass
class Network:
    ssid: str
    signal: int  # 0-100
    security: str  # open, wpa2, etc.


def _validate_ssid(ssid: str) -> None:
    """Validate SSID: ≤32 UTF-8 bytes, no null."""
    if not ssid or len(ssid.encode("utf-8")) > 32:
        raise ValueError("Invalid SSID: must be 1-32 bytes")
    if "\x00" in ssid:
        raise ValueError("Invalid SSID: contains null byte")


def _validate_password(password: str) -> None:
    """Validate password: 8-64 UTF-8 bytes."""
    if len(password.encode("utf-8")) < 8 or len(password.encode("utf-8")) > 64:
        raise ValueError("Password must be 8-64 bytes")


def scan(nmcli_exe: str = "nmcli") -> list[Network]:
    """Scan nearby networks. Returns sorted by signal strength."""
    try:
        output = subprocess.check_output(
            [nmcli_exe, "dev", "wifi", "list", "--rescan", "no"],
            text=True,
            timeout=10,
        )
    except subprocess.CalledProcessError as e:
        raise RuntimeError(f"nmcli scan failed: {e}")

    networks = []
    # Parse tabular output: SSID SECURITY SIGNAL
    for line in output.strip().split("\n")[1:]:  # Skip header
        parts = line.split()
        if len(parts) >= 3:
            ssid = parts[0]
            # Try to find signal (digit at end or second-to-last)
            signal = 0
            security = "WPA2"
            for i, part in enumerate(reversed(parts)):
                if part.isdigit():
                    signal = int(part)
                    # Security is before the signal
                    if i + 1 < len(parts):
                        security = parts[-(i + 2)]
                    break
            networks.append(Network(ssid=ssid, signal=signal, security=security))

    return sorted(networks, key=lambda n: -n.signal)


def join(ssid: str, password: str, nmcli_exe: str = "nmcli", timeout: int = 60) -> bool:
    """Join a Wi-Fi network. Validates inputs first."""
    _validate_ssid(ssid)
    _validate_password(password)

    try:
        subprocess.run(
            [nmcli_exe, "dev", "wifi", "connect", ssid, "password", password],
            check=True,
            timeout=timeout,
            capture_output=True,
        )
        return True
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, Exception):
        return False


def status(nmcli_exe: str = "nmcli") -> dict:
    """Get current Wi-Fi status: connected, ssid, signal."""
    try:
        output = subprocess.check_output(
            [nmcli_exe, "-t", "-f", "NAME,STATE", "dev", "show"],
            text=True,
            timeout=5,
        )
    except subprocess.CalledProcessError:
        return {"connected": False, "ssid": None, "signal": 0}

    connected = False
    ssid = None
    for line in output.strip().split("\n"):
        # Only match "connected" as its own word, not in "disconnected"
        if ":connected" in line.lower():
            connected = True
            parts = line.split(":")
            if len(parts) >= 2:
                ssid = parts[0].strip()
    return {"connected": connected, "ssid": ssid, "signal": 0}


def forget(ssid: str, nmcli_exe: str = "nmcli") -> bool:
    """Forget a saved Wi-Fi connection."""
    _validate_ssid(ssid)
    try:
        subprocess.run(
            [nmcli_exe, "connection", "delete", ssid],
            check=True,
            timeout=5,
            capture_output=True,
        )
        return True
    except subprocess.CalledProcessError:
        return False
