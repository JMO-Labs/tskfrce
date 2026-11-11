"""Parent API: Wi-Fi setup and management."""

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from app.api.deps import require_parent
from app.services import country_code, network_wifi, setup_mode

router = APIRouter(
    prefix="/api/v1/network/wifi", tags=["wifi"], dependencies=[Depends(require_parent)]
)


class WifiNetwork(BaseModel):
    ssid: str
    signal: int
    security: str


class ScanResponse(BaseModel):
    networks: list[WifiNetwork]


class JoinRequest(BaseModel):
    ssid: str
    password: str = Field(min_length=8, max_length=64)


class JoinResponse(BaseModel):
    status: str  # "joining", "connected", "error"
    reason: str | None = None


class StatusResponse(BaseModel):
    connected: bool
    ssid: str | None
    signal: int


@router.post("/scan", response_model=ScanResponse)
def scan_wifi():
    """Scan nearby Wi-Fi networks."""
    try:
        networks = network_wifi.scan()
        return {"networks": [n.__dict__ for n in networks]}
    except Exception as e:
        raise HTTPException(500, f"Scan failed: {e}")


@router.post("/join", response_model=JoinResponse)
def join_wifi(body: JoinRequest):
    """Join a Wi-Fi network."""
    try:
        success = network_wifi.join(body.ssid, body.password, timeout=60)
        if success:
            return {"status": "connected", "reason": None}
        return {"status": "error", "reason": "connection_failed"}
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"Join failed: {e}")


@router.get("/status", response_model=StatusResponse)
def get_status():
    """Get current Wi-Fi status."""
    try:
        status_dict = network_wifi.status()
        return status_dict
    except Exception as e:
        raise HTTPException(500, f"Status check failed: {e}")


@router.post("/forget")
def forget_wifi():
    """Forget the currently connected Wi-Fi network."""
    try:
        status_dict = network_wifi.status()
        if status_dict["ssid"]:
            network_wifi.forget(status_dict["ssid"])
            return {"status": "forgotten"}
        return {"status": "not_connected"}
    except Exception as e:
        raise HTTPException(500, f"Forget failed: {e}")


@router.post("/settings-join", response_model=JoinResponse)
def settings_join(body: JoinRequest):
    """Join from Settings with 60s rollback to previous network."""
    try:
        # Use SetupModeManager for rollback logic (even though not in setup mode)
        manager = setup_mode.SetupModeManager("temp", "")  # dummy box_id/password
        success = manager.process_settings_join(body.ssid, body.password)
        if success:
            # Try to apply country code if available
            country_code.apply_country_code()
            return {"status": "connected", "reason": None}
        return {"status": "error", "reason": "connection_failed"}
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"Settings join failed: {e}")


@router.post("/apply-country")
def apply_country():
    """Apply country code from domain service CF-IPCountry header."""
    try:
        success = country_code.apply_country_code()
        cc = country_code.get_country_code()
        return {"applied": success, "country": cc}
    except Exception as e:
        raise HTTPException(500, f"Country apply failed: {e}")


# Captive portal probe URL handlers (no auth required)
# These redirect to the setup page while in setup mode
_SETUP_TRIGGER = Path("/var/lib/tskfrce/setup-mode.active")


def _is_setup_mode() -> bool:
    """Check if setup mode is active."""
    return _SETUP_TRIGGER.exists()


@router.get("/hotspot-detect.html")
def hotspot_detect_apple():
    """Apple's captive portal probe."""
    if _is_setup_mode():
        return Response(
            status_code=302,
            headers={"Location": "http://10.42.0.1/setup"},
        )
    return Response(status_code=200, content="Success")


@router.get("/generate_204")
def generate_204_android():
    """Android's captive portal probe."""
    if _is_setup_mode():
        return Response(
            status_code=302,
            headers={"Location": "http://10.42.0.1/setup"},
        )
    return Response(status_code=204)


@router.get("/connecttest.txt")
def connecttest_windows():
    """Windows's captive portal probe (option 1)."""
    if _is_setup_mode():
        return Response(
            status_code=302,
            headers={"Location": "http://10.42.0.1/setup"},
        )
    return Response(status_code=200, content="Microsoft Connect Test")


@router.get("/ncsi.txt")
def ncsi_windows():
    """Windows's captive portal probe (option 2)."""
    if _is_setup_mode():
        return Response(
            status_code=302,
            headers={"Location": "http://10.42.0.1/setup"},
        )
    return Response(status_code=200, content="Microsoft NCSI")
