"""Parent API: Wi-Fi setup and management."""

import ipaddress

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from app.api.deps import require_parent
from app.core.client_ip import client_ip
from app.services import country_code, network_wifi, setup_mode

# Parent auth router
router = APIRouter(
    prefix="/api/v1/network/wifi", tags=["wifi"], dependencies=[Depends(require_parent)]
)

# Setup mode router (unauthenticated, IP-restricted)
setup_router = APIRouter(prefix="/api/v1/network/wifi/setup", tags=["wifi-setup"])


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


def _verify_hotspot_request(request: Request) -> None:
    """Verify request is from hotspot client with valid token and setup mode active."""
    # SECURITY: Use client_ip() helper (handles trusted proxy correctly)
    ip = client_ip(request)

    # SECURITY: Require X-Edge-Token (reuse main site's token mechanism)
    token = request.headers.get("X-Edge-Token", "")
    if not token:
        raise HTTPException(403, "Missing X-Edge-Token")

    # SECURITY: Verify IP is in hotspot subnet (10.42.0.0/24)
    try:
        addr = ipaddress.ip_address(ip)
        if not addr in ipaddress.ip_network("10.42.0.0/24"):
            raise HTTPException(403, "Client IP outside hotspot subnet")
    except ValueError:
        raise HTTPException(403, "Invalid client IP")

    # SECURITY: Check setup mode is active (query helper socket)
    try:
        status = network_wifi._call_helper("status")
        # Helper's hotspot_active flag indicates setup mode
        if not status.get("hotspot_active"):
            raise HTTPException(503, "Setup mode not active")
    except RuntimeError:
        raise HTTPException(503, "Cannot verify setup mode")


@setup_router.post("/join", response_model=JoinResponse)
def setup_join(request: Request, body: JoinRequest):
    """Setup mode: join a Wi-Fi network (hotspot clients only, requires X-Edge-Token)."""
    # SECURITY: Verify hotspot client, token, and setup mode active
    _verify_hotspot_request(request)

    try:
        success = network_wifi.join(body.ssid, body.password, timeout=60)
        if success:
            return {"status": "connected", "reason": None}
        return {"status": "error", "reason": "connection_failed"}
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"Join failed: {e}")
