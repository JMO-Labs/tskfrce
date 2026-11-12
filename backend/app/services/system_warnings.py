"""Serious box problems for the Today warning strip. Not dismissable: they clear with the cause.

Sources that don't exist yet are stubbed off, never faked.
"""

import shutil
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.api import updates
from app.models.family import get_family
from app.models.network import Network
from app.services import box_power, network_wifi

BLOCKER_STALE = timedelta(minutes=10)
STORAGE_FULL = 0.9


def _w(key, title, body, label, to) -> dict:
    return {"key": key, "title": title, "body": body, "action": {"label": label, "to": to}}


def blocker_down(db: Session, now: datetime) -> list[dict]:
    seen = get_family(db).blocker_last_seen
    if seen is None:  # never reported: still being set up, not a failure
        return []
    live = now - seen <= BLOCKER_STALE
    nets = db.query(Network).all()
    # No networks reported yet (legacy LAN_IFACE mode / first report): blocking works.
    if live and (not nets or any(n.enforce for n in nets)):
        return []
    why = (
        "The blocker hasn't checked in for a while, so nothing is being blocked."
        if not live
        else 'No network is set to "Enforce here", so nothing is being blocked.'
    )
    return [_w("blocker.down", "Kid limits aren't being enforced", why, "Open Devices", "/devices")]


def blocker_bind(db: Session, now: datetime) -> list[dict]:
    """Stub: the blocker doesn't report a failed bind yet (it only logs it)."""
    return []


def wifi_down(db: Session, now: datetime) -> list[dict]:
    try:
        st = network_wifi.status()
    except RuntimeError:  # no network daemon on this box
        return []
    if st.get("online", True):
        return []
    return [
        _w(
            "wifi.down",
            "The box is offline",
            "Wi-Fi is disconnected and no cable is plugged in, so updates and phone "
            "access won't work.",
            "Fix Wi-Fi",
            "/settings?section=wifi",
        )
    ]


def rollback_unhealthy(db: Session, now: datetime) -> list[dict]:
    if not updates._read_state().get("rollback_unhealthy"):
        return []
    return [
        _w(
            "update.unhealthy",
            "The last update failed and the box isn't healthy",
            "Going back to the old version didn't bring everything back up.",
            "Open Updates",
            "/settings?section=updates",
        )
    ]


def storage_full(db: Session, now: datetime) -> list[dict]:
    try:
        u = shutil.disk_usage(box_power.data_dir())
    except OSError:
        return []
    if not u.total or u.used / u.total < STORAGE_FULL:
        return []
    return [
        _w(
            "storage.full",
            "The box is almost out of space",
            f"{round(100 * u.used / u.total)}% full. It may stop saving chores and photos.",
            "Open Settings",
            "/settings",
        )
    ]


CHECKS = (blocker_down, blocker_bind, wifi_down, rollback_unhealthy, storage_full)


def warnings(db: Session, now: datetime | None = None) -> dict:
    now = now or datetime.utcnow()
    return {"items": [w for check in CHECKS for w in check(db, now)]}
