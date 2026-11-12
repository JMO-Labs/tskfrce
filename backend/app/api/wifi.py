"""Wi-Fi API: parent Settings routes, plus the captive setup page's hotspot-only routes."""

import ipaddress
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_parent, security, user_from_token
from app.core.client_ip import client_ip
from app.eval.events import box_fault
from app.models.user import User, UserRole
from app.services import network_wifi

router = APIRouter(
    prefix="/api/v1/network/wifi", tags=["wifi"], dependencies=[Depends(require_parent)]
)
# Unauthenticated, but only for setup-hotspot clients while the hotspot is up (_hotspot_only).
setup_router = APIRouter(prefix="/api/v1/network/wifi/setup", tags=["wifi-setup"])

HOTSPOT_NET = ipaddress.ip_network("10.42.0.0/24")


class JoinRequest(BaseModel):
    ssid: str
    password: str = ""
    security: Literal["wpa", "sae", "open"] = "wpa"
    hidden: bool = False


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
    res = _daemon(network_wifi.join, body.ssid, body.password, body.security, body.hidden)
    if res.get("success") is False:
        box_fault("netd", "join_fail")
    return res


@router.post("/forget")
def forget_wifi(body: ForgetRequest) -> dict:
    return _daemon(network_wifi.forget, body.ssid)


@router.post("/country")
def set_country(body: CountryRequest) -> dict:
    """Manual country for IP-mode boxes; domain boxes get it from CF-IPCountry."""
    return _daemon(network_wifi.set_country, body.country)


def _hotspot_only(request: Request, allow_connecting: bool = False) -> dict:
    """Hotspot subnet (real client IP via our trusted proxy) + hotspot really up.

    No edge token: hotspot phones reach the frontend directly at 10.42.0.1, and only phones
    that joined the setup Wi-Fi (sticker password) can have a 10.42.0.x address.
    """
    try:
        if ipaddress.ip_address(client_ip(request)) not in HOTSPOT_NET:
            raise HTTPException(403, "Not a setup hotspot client")
    except ValueError as e:
        raise HTTPException(403, "Not a setup hotspot client") from e
    status = _daemon(network_wifi.status)
    connecting = status.get("setup", {}).get("phase") == "connecting"
    if not (status.get("hotspot_active") or (allow_connecting and connecting)):
        raise HTTPException(409, "Setup mode is not active")
    return status


_last_phase: list[str | None] = [None]


def _note_phase(phase: str | None) -> None:
    """A failed captive join means netd raised the hotspot again: report it once per failure."""
    if phase == "failed" and _last_phase[0] != "failed":
        box_fault("netd", "join_fail")
        box_fault("netd", "hotspot_up")
    _last_phase[0] = phase


@setup_router.get("/status")
def setup_status(request: Request) -> dict:
    """Captive page polls this: phase idle|connecting|connected|failed, error wrong_password|failed."""
    setup = _hotspot_only(request, allow_connecting=True).get("setup", {})
    _note_phase(setup.get("phase"))
    return setup


@setup_router.get("/scan")
def setup_scan(request: Request) -> dict:
    """Networks the box can see, for the captive page's picker (hotspot clients only)."""
    _hotspot_only(request)
    return {"networks": _daemon(network_wifi.scan)}


@setup_router.post("/join")
def setup_join(
    request: Request,
    body: JoinRequest,
    db: Session = Depends(get_db),
    token: HTTPAuthorizationCredentials | None = Depends(security),
) -> dict:
    _hotspot_only(request)
    # First run (no family yet): anyone on the setup hotspot may pick the home Wi-Fi.
    # After that the hotspot is only a fallback, and its password is on the sticker a kid can
    # read, so moving the box to another network needs a parent session.
    if db.query(User.id).first() is not None:
        user = user_from_token(token.credentials if token else None, db)
        if user is None:
            raise HTTPException(401, "Sign in as a parent to change the box's Wi-Fi.")
        if not user.is_active or user.role != UserRole.PARENT:
            raise HTTPException(403, "Only parents can change the box's Wi-Fi.")
    res = _daemon(network_wifi.setup_join, body.ssid, body.password, body.security, body.hidden)
    if res.get("success") is False:
        box_fault("netd", "join_fail")
    return res
