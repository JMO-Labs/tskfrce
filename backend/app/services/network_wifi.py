"""Client for the host network daemon (scripts/tskfrce-netd.py) over its Unix socket.

The daemon re-validates everything; checks here just fail fast with a clear 400.
"""

import json
import socket

SOCKET_PATH = "/run/tskfrce/wifi.sock"


def _call(cmd: str, timeout: float = 15, **kwargs) -> dict:
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
            s.settimeout(timeout)
            s.connect(SOCKET_PATH)
            s.sendall((json.dumps({"cmd": cmd, **kwargs}) + "\n").encode())
            buf = b""
            while not buf.endswith(b"\n"):
                chunk = s.recv(65536)
                if not chunk:
                    break
                buf += chunk
        return json.loads(buf)
    except (OSError, ValueError) as e:
        raise RuntimeError(f"network daemon unavailable: {type(e).__name__}") from e


def validate_ssid(ssid: str) -> None:
    b = ssid.encode()
    if not 1 <= len(b) <= 32 or any(c < 0x20 or c == 0x7F for c in b):
        raise ValueError("Wi-Fi name must be 1-32 bytes with no control characters")


def validate_password(pw: str) -> None:
    if len(pw) == 64:
        if all(c in "0123456789abcdefABCDEF" for c in pw):
            return
        raise ValueError("A 64-character password must be hex")
    if not 8 <= len(pw) <= 63 or any(not 0x20 <= ord(c) < 0x7F for c in pw):
        raise ValueError("Password must be 8-63 printable characters")


def scan() -> list[dict]:
    return _call("scan", timeout=30).get("networks", [])


def status() -> dict:
    return _call("status")


def join(ssid: str, password: str) -> dict:
    """Settings join: the daemon rolls back to the previous network on failure."""
    validate_ssid(ssid)
    validate_password(password)
    return _call("join", timeout=120, ssid=ssid, password=password)


def setup_join(ssid: str, password: str) -> dict:
    """Captive-page join: returns at once; poll status()['setup'] for the result."""
    validate_ssid(ssid)
    validate_password(password)
    return _call("setup_join", ssid=ssid, password=password)


def forget(ssid: str) -> dict:
    validate_ssid(ssid)
    return _call("forget", ssid=ssid)


def set_country(cc: str) -> dict:
    if len(cc) != 2 or not cc.isascii() or not cc.isalpha():
        raise ValueError("Country must be two letters")
    return _call("set_country", country=cc.upper())
