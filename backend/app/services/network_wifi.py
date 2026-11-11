"""Wi-Fi management via host-side privileged helper (Unix socket)."""

import json
import socket
from dataclasses import dataclass


@dataclass
class Network:
    ssid: str
    signal: int  # 0-100
    security: str  # open, wpa2, etc.


SOCKET_PATH = "/run/tskfrce-wifi.sock"


def _call_helper(cmd: str, **kwargs) -> dict:
    """Call the privileged host helper via Unix socket."""
    payload = {"cmd": cmd, **kwargs}
    try:
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.settimeout(10)
        sock.connect(SOCKET_PATH)
        sock.sendall((json.dumps(payload) + "\n").encode())
        response = sock.recv(4096).decode().strip()
        sock.close()
        return json.loads(response)
    except (FileNotFoundError, ConnectionRefusedError):
        raise RuntimeError(f"Helper socket {SOCKET_PATH} unavailable")
    except json.JSONDecodeError as e:
        raise RuntimeError(f"Helper reply parse error: {e}")


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


def scan() -> list[Network]:
    """Scan nearby networks. Returns sorted by signal strength."""
    resp = _call_helper("scan")
    if resp.get("error"):
        raise RuntimeError(f"Scan failed: {resp['error']}")
    return [Network(**n) for n in resp.get("networks", [])]


def join(ssid: str, password: str, timeout: int = 60) -> bool:
    """Join a Wi-Fi network. Validates inputs first."""
    _validate_ssid(ssid)
    _validate_password(password)
    resp = _call_helper("join", ssid=ssid, password=password, timeout=timeout)
    return resp.get("success", False)


def status() -> dict:
    """Get current Wi-Fi status: connected, ssid, signal."""
    resp = _call_helper("status")
    return {
        "connected": resp.get("connected", False),
        "ssid": resp.get("ssid"),
        "signal": resp.get("signal", 0),
    }


def forget(ssid: str) -> bool:
    """Forget a saved Wi-Fi connection."""
    _validate_ssid(ssid)
    resp = _call_helper("forget", ssid=ssid)
    return resp.get("success", False)


def hotspot_up(ssid: str, password: str, country: str = "US") -> bool:
    """Start setup mode hotspot."""
    _validate_ssid(ssid)
    _validate_password(password)
    resp = _call_helper("hotspot_up", ssid=ssid, password=password, country=country)
    return resp.get("success", False)


def hotspot_down() -> bool:
    """Stop setup mode hotspot."""
    resp = _call_helper("hotspot_down")
    return resp.get("success", False)


def set_country(cc: str) -> bool:
    """Set regulatory domain country code."""
    if not cc or len(cc) != 2 or not cc.isalpha():
        raise ValueError("Country code must be 2 letters")
    resp = _call_helper("set_country", country=cc)
    return resp.get("success", False)
