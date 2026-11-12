"""Event allow-list (browser events) and Umami payload builder."""

import re
import time

from app.core.logging import get_logger
from app.eval import store
from app.eval.config import APP_VERSION, eval_settings, stats_on

logger = get_logger(__name__)

AGE_GROUPS = ("≤7", "8–10", "11–13", "14+")
ROUTES = frozenset(
    {
        "/",
        "/chat",
        "/devices",
        "/kid",
        "/kids",
        "/more",
        "/notifications",
        "/recap",
        "/settings",
        "/setup",
        "/wifi-setup",
        "/login",
        "/join",
        "/register",
        "/reset",
        "/404",
    }
)
SECTIONS = frozenset(
    {  # settingsSections.ts ids + kid tab ids (KidNav.tsx)
        "family", "hours", "notifications", "look", "gifs", "homework", "parents",
        "integrations", "wifi", "updates", "eval",
        "chores", "games", "rewards", "chat", "alerts", "me",
    }
)  # fmt: skip
AREAS = frozenset(
    {
        "goals", "penalties", "rewards", "badges", "minigames", "homework", "happy_hour",
        "time_bank", "integrations", "notifications", "devices", "wifi", "updates",
        "parents", "reset",
    }
)  # fmt: skip
ACTIONS = frozenset(
    {"open", "start", "done", "fail", "toggle_on", "toggle_off", "create", "delete"}
)
AUTH_STEPS = frozenset({"login", "register", "join", "reset_pin", "forgot_pin"})
AUTH_RESULTS = frozenset({"ok", "fail_pin", "fail_code", "locked", "error"})
FORMS = ("chore", "kid", "window", "feedback")
WIZARD_STEPS = 7  # frontend/src/v2/setup/WizardFrame.tsx STEPS
_ERR = re.compile(r"^(http_[1-5]\d\d|network|other)$")


FAULT_COMPONENTS = frozenset({"blocker", "netd", "edge", "updater", "cert", "registry"})
FAULT_KINDS = frozenset(
    {
        "bind_fail", "hotspot_up", "join_fail", "rollback", "sig_fail", "update_fail",
        "cert_fail", "dns_fail", "report_fail", "crash",
    }
)  # fmt: skip


def clean(name: str, props: dict) -> dict | None:
    """Whitelist browser event props; None means drop the event."""
    if name == "screen_view":
        r = props.get("route")
        out = {"route": r if isinstance(r, str) and r in ROUTES else "other"}
        sec = props.get("section")
        if isinstance(sec, str) and sec in SECTIONS:
            out["section"] = sec
        return out
    if name == "feature":
        a, act = props.get("area"), props.get("action")
        if isinstance(a, str) and isinstance(act, str) and a in AREAS and act in ACTIONS:
            return {"area": a, "action": act}
        return None
    if name == "auth":
        st, res = props.get("step"), props.get("result")
        if (
            isinstance(st, str)
            and isinstance(res, str)
            and st in AUTH_STEPS
            and res in AUTH_RESULTS
        ):
            return {"step": st, "result": res}
        return None
    if name == "wizard_step":
        s, state = props.get("step"), props.get("state")
        if isinstance(s, bool) or not (
            isinstance(s, int) or (isinstance(s, str) and s.isascii() and s.isdigit())
        ):
            return None
        if not 1 <= int(s) <= WIZARD_STEPS or state not in ("started", "done"):
            return None
        return {"step": int(s), "state": state}
    if name == "wizard_done":
        return {}
    if name == "form_abandoned":
        f = props.get("form")
        return {"form": f} if f in FORMS else None
    if name == "error_shown":
        k = props.get("kind")
        return {"kind": k if isinstance(k, str) and _ERR.fullmatch(k) else "other"}
    return None


def duration_bucket(minutes: int | None) -> str:
    if minutes is None:
        return "until_cleared"
    if minutes <= 30:
        return "30m"
    if minutes <= 120:
        return "2h"
    return "8h" if minutes <= 480 else "24h"


def umami_body(
    name: str, data: dict, *, source: str, age_group: str | None, url: str, ts: float
) -> dict:
    hh = store.household()
    extra = {"household": hh, "app_version": APP_VERSION, "source": source}
    if age_group is not None:
        extra["age_group"] = age_group
    return {
        "type": "event",
        "payload": {
            "website": eval_settings.EVAL_UMAMI_WEBSITE_ID,
            "hostname": "box",
            "url": url,
            "name": name,
            "id": hh,
            "ip": "192.0.2.1",
            "timestamp": int(ts),
            "data": {**data, **extra},
        },
    }


def emit(
    name: str,
    data: dict | None = None,
    *,
    source: str = "box",
    age_group: str | None = None,
    url: str = "/box",
) -> None:
    if not stats_on():
        return
    try:
        ts = time.time()
        body = umami_body(name, data or {}, source=source, age_group=age_group, url=url, ts=ts)
        store.enqueue("umami", body, now=ts, capped=name != "heartbeat")
    except Exception as e:
        logger.warning("eval_emit_failed", event=name, error=type(e).__name__)


def box_fault(component: str, kind: str) -> bool:
    """Emit box_fault{component, kind}; enums only, anything else is dropped. True if queued."""
    if component not in FAULT_COMPONENTS or kind not in FAULT_KINDS or not stats_on():
        return False
    emit("box_fault", {"component": component, "kind": kind}, url="/box")
    return True
