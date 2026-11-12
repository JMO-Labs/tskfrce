"""Box-health suggestions: updates, edge certificate, power outages."""

import os
from datetime import UTC, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.api import updates
from app.core.config import settings
from app.models.family import get_family
from app.services import box_power
from app.services.suggestions.rules import SYSTEM, _s

CERT_DAYS = 14
OUTAGE_SHOW_DAYS = 7
UPS_COUNT, UPS_DAYS = 2, 30
ISO = box_power.ISO


def _state_time(state: dict, default: datetime) -> datetime:
    try:
        return datetime.fromisoformat(state["last_at"])
    except (KeyError, ValueError, TypeError):
        return default


def update_ready(db: Session, now: datetime) -> list[dict]:
    st = updates._read_state()
    major = st.get("major_available")
    if not major:
        return []
    return [
        _s(
            "update.ready",
            None,
            SYSTEM,
            major,
            _state_time(st, now),
            "A new version is ready",
            f"Version {major} is available for this box.",
            "link",
            "Open Updates",
            "/settings?section=updates",
        )
    ]


def update_failed(db: Session, now: datetime) -> list[dict]:
    st = updates._read_state()
    if st.get("last_result") != "failed":
        return []
    at = _state_time(st, now)
    return [
        _s(
            "update.failed",
            None,
            SYSTEM,
            st.get("last_at") or "failed",
            at,
            "Last night's update didn't go through",
            "The box went back to the version it was on and will try again.",
            "link",
            "See details",
            "/settings?section=updates",
        )
    ]


def _cert_expiry() -> datetime | None:
    """Soonest expiry among readable edge certs; None if none are mounted/readable."""
    from cryptography import x509

    soonest = None
    edge = Path(os.environ.get("EDGE_DATA_DIR") or settings.EDGE_DATA_DIR)
    for f in sorted((edge / "lego" / "certificates").glob("*.crt")):
        try:
            end = x509.load_pem_x509_certificate(f.read_bytes()).not_valid_after_utc
        except (OSError, ValueError):
            continue
        soonest = end if soonest is None or end < soonest else soonest
    return soonest


def cert_expiring(db: Session, now: datetime) -> list[dict]:
    end = _cert_expiry()
    if end is None:
        return []
    left = end - now.replace(tzinfo=UTC)
    if left > timedelta(days=CERT_DAYS):
        return []
    days = max(left.days, 0)
    return [
        _s(
            "cert.expiring",
            None,
            SYSTEM,
            end.date().isoformat(),
            now,
            "The box's secure-link certificate is about to expire",
            f"It runs out in {days} day{'s' if days != 1 else ''}. "
            "It normally renews itself; if it doesn't, phones may show a warning.",
            "link",
            "Open help",
            "/help",
        )
    ]


def box_power_rule(db: Session, now: datetime) -> list[dict]:
    found = box_power.outages()
    if not found:
        return []
    last = found[-1]
    start, end = datetime.strptime(last["start"], ISO), datetime.strptime(last["end"], ISO)
    if now - end > timedelta(days=OUTAGE_SHOW_DAYS):
        return []
    try:
        tz = ZoneInfo(get_family(db).timezone)
    except Exception:
        tz = UTC

    def local(d: datetime) -> str:
        return d.replace(tzinfo=UTC).astimezone(tz).strftime("%H:%M")

    body = []
    if settings.LOCK_LOOP_ENABLED:  # only what the box can confirm
        body.append("Locks were re-applied when power came back.")
    recent = [
        o for o in found if now - datetime.strptime(o["end"], ISO) <= timedelta(days=UPS_DAYS)
    ]
    if len(recent) >= UPS_COUNT:
        body.append(
            f"That's {len(recent)} power cuts in {UPS_DAYS} days. "
            "A small UPS battery would keep the box running through short ones."
        )
    return [
        _s(
            "box.power",
            None,
            SYSTEM,
            last["start"],
            end,
            f"The box was off {local(start)}–{local(end)}",
            " ".join(body) or "It's running normally again.",
            "link",
            "Open help",
            "/help",
        )
    ]
