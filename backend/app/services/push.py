"""Push kid alerts to the box's own ntfy after the DB commit."""

import os
import threading
from urllib.parse import urlparse

import httpx
from sqlalchemy import event, inspect
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.logging import get_logger
from app.models.user import User, UserRole
from app.services import inbox

logger = get_logger(__name__)
URGENT = {"due_soon", "missed_deadline", "lock_warning"}
# Upstream (third-party ntfy) sees only these fixed lines, never names or titles.
GENERIC = {
    "chore_new": "You have a new chore",
    "due_soon": "A chore is due soon",
    "missed_deadline": "A chore is overdue",
    "chore_approved": "A chore was approved",
    "chore_sent_back": "A chore needs another look",
    "points_taken": "Your points changed",
    "lock_warning": "Screen time ends soon",
    "chat_message": "You have a new message",
    "redemption_decided": "A reward request was answered",
    "badge_earned": "You earned a badge",
    "level_up": "You reached a new level",
}


def public_url() -> str | None:
    if settings.NTFY_PUBLIC_URL:
        return settings.NTFY_PUBLIC_URL
    u = urlparse(settings.BOX_URL or "")
    if u.scheme != "http" or not u.hostname:
        return None  # never build the LAN ntfy URL from an https hostname
    port = settings.NTFY_PORT.rsplit(":", 1)[-1] or "2586"
    return f"http://{u.hostname}:{port}"


def enabled() -> bool:
    return bool(settings.NTFY_URL and public_url())


def conf_text(relay: bool) -> str:
    return 'upstream-base-url: "https://ntfy.sh"\n' if relay else "# relay off\n"


def write_conf(fam) -> None:
    path = settings.NTFY_CONF_FILE
    if not path:
        return
    try:
        text = conf_text(fam.ntfy_upstream_relay)
        try:
            with open(path) as f:
                if f.read() == text:
                    return
        except FileNotFoundError:
            pass
        tmp = f"{path}.tmp"
        with open(tmp, "w") as f:
            f.write(text)
        os.replace(tmp, path)
    except Exception as e:
        logger.warning("ntfy conf write failed", error=str(e))


def queue(db: Session, user_id: int, kind: str, title: str, body: str | None, row=None) -> None:
    """Stage a push; sent after commit. `row` lets a savepoint rollback cancel it."""
    if kind not in inbox.KID_KINDS:
        return
    lan = enabled()
    up = bool(settings.NTFY_UPSTREAM_URL)
    if not (lan or up):
        return
    u = db.get(User, user_id)
    if not u or u.role != UserRole.KID:
        return
    prio = 4 if kind in URGENT else 3
    out = db.info.setdefault("push_out", [])
    if lan and u.push_topic:
        base = settings.BOX_URL
        out.append(
            {
                "topic": u.push_topic,
                "title": title,
                "message": body or "",
                "click": f"{base.rstrip('/')}/kid" if base else None,
                "priority": prio,
                "_row": row,
            }
        )
    if up and u.alert_topic:
        out.append(
            {
                "topic": u.alert_topic,
                "title": "t@sk4ce",
                "message": GENERIC[kind],
                "priority": prio,
                "_up": True,
                "_row": row,
            }
        )


def _spawn(fn, *args) -> None:
    threading.Thread(target=fn, args=args, daemon=True).start()


def send(item: dict) -> None:
    item = dict(item)
    up = item.pop("_up", False)
    try:
        if up:
            headers = {}
            if settings.NTFY_UPSTREAM_TOKEN:
                headers["Authorization"] = f"Bearer {settings.NTFY_UPSTREAM_TOKEN}"
            url = f"{settings.NTFY_UPSTREAM_URL.rstrip('/')}/"
            r = httpx.post(url, json=item, headers=headers, timeout=5)
        else:
            r = httpx.post(f"{settings.NTFY_URL}/", json=item, timeout=5)
        r.raise_for_status()
    except Exception as e:
        logger.warning("Upstream push failed" if up else "Push failed", error=type(e).__name__)


def _send_all(items: list[dict]) -> None:
    for i in sorted(items, key=lambda i: bool(i.get("_up"))):  # LAN first
        send(i)


@event.listens_for(Session, "after_commit")
def _after_commit(session: Session) -> None:
    if session.in_nested_transaction():  # savepoint release, not the real commit
        return
    items = session.info.pop("push_out", None)
    if not items:
        return
    # rows rolled back in a savepoint are no longer persistent
    live = [
        {k: v for k, v in i.items() if k != "_row"}
        for i in items
        if i["_row"] is None or inspect(i["_row"]).persistent
    ]
    if live:
        _spawn(_send_all, live)


@event.listens_for(Session, "after_rollback")
def _after_rollback(session: Session) -> None:
    if session.in_nested_transaction():  # savepoint rollback; _row filter handles it
        return
    session.info.pop("push_out", None)
