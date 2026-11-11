"""Wi-Fi API: parent Settings routes, plus the captive setup page's hotspot-only routes."""

import hmac
import ipaddress

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app.api.deps import require_parent
from app.core.client_ip import client_ip
from app.core.config import settings
from app.services import network_wifi

router = APIRouter(
    prefix="/api/v1/network/wifi", tags=["wifi"], dependencies=[Depends(require_parent)]
)
# Unauthenticated, but only for hotspot clients via the edge's hotspot site (see _hotspot_only).
setup_router = APIRouter(prefix="/api/v1/network/wifi/setup", tags=["wifi-setup"])

HOTSPOT_NET = ipaddress.ip_network("10.42.0.0/24")


class JoinRequest(BaseModel):
    ssid: str
    password: str


class ForgetRequest(BaseModel):
    ssid: str


class CountryRequest(BaseModel):
    country: str


def _daemon(fn, *args) -> dict:
    try:
        return fn(*args)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    except RuntimeError as e:
        raise HTTPException(503, "Network service unavailable") from e


@router.get("/status")
def get_status() -> dict:
    return _daemon(network_wifi.status)


@router.post("/scan")
def scan_wifi() -> dict:
    return {"networks": _daemon(network_wifi.scan)}


@router.post("/join")
def join_wifi(body: JoinRequest) -> dict:
    """Join from Settings. On failure the box returns to the previous network."""
    return _daemon(network_wifi.join, body.ssid, body.password)


@router.post("/forget")
def forget_wifi(body: ForgetRequest) -> dict:
    return _daemon(network_wifi.forget, body.ssid)


@router.post("/country")
def set_country(body: CountryRequest) -> dict:
    """Manual country for IP-mode boxes; domain boxes get it from CF-IPCountry."""
    return _daemon(network_wifi.set_country, body.country)


def _hotspot_only(request: Request) -> dict:
    """Edge token + hotspot subnet + hotspot really up. Returns daemon status."""
    if not settings.EDGE_TOKEN:
        raise HTTPException(503, "Setup mode not configured")
    if not hmac.compare_digest(request.headers.get("X-Edge-Token", ""), settings.EDGE_TOKEN):
        raise HTTPException(403, "Invalid or missing X-Edge-Token")
    try:
        if ipaddress.ip_address(client_ip(request)) not in HOTSPOT_NET:
            raise HTTPException(403, "Not a setup hotspot client")
    except ValueError as e:
        raise HTTPException(403, "Not a setup hotspot client") from e
    status = _daemon(network_wifi.status)
    if not status.get("hotspot_active") and status.get("setup", {}).get("phase") != "connecting":
        raise HTTPException(409, "Setup mode is not active")
    return status


@setup_router.get("/status")
def setup_status(request: Request) -> dict:
    """Captive page polls this: phase idle|connecting|connected|failed, error wrong_password|failed."""
    return _hotspot_only(request).get("setup", {})


@setup_router.post("/join")
def setup_join(request: Request, body: JoinRequest) -> dict:
    _hotspot_only(request)
    return _daemon(network_wifi.setup_join, body.ssid, body.password)
