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
GAME_IDS = frozenset({"quickfire", "hungry-cat", "math-dash", "pack-the-box", "shelf-memory"})
GAME_RESULTS = frozenset({"start", "finish", "quit"})
DURATION_BUCKETS = frozenset({"<30s", "30-60s", "1-2m", "2-5m", "5m+"})
SCORE_BUCKETS = frozenset({"0", "1-9", "10-49", "50-199", "200-999", "1000+"})
SETUP_WHAT = frozenset(
    {
        "devices_found_0", "devices_found_1_3", "devices_found_4_9", "devices_found_10p",
        "rescan", "name_edited", "wifi_changed",
        "preset_relaxed", "preset_balanced", "preset_strict", "preset_mixed",
        "chores_kept_0", "chores_kept_lt50", "chores_kept_50_99", "chores_kept_100",
    }
)  # fmt: skip
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
        s, state = _step(props.get("step")), props.get("state")
        return {"step": s, "state": state} if s and state in ("started", "done") else None
    if name == "game":
        return _game(props)
    if name == "setup_detail":
        st, what = _step(props.get("step")), props.get("what")
        return {"step": st, "what": what} if st and _in(what, SETUP_WHAT) else None
    if name == "wizard_done":
        return {}
    if name == "form_abandoned":
        f = props.get("form")
        return {"form": f} if f in FORMS else None
    if name == "error_shown":
        k = props.get("kind")
        return {"kind": k if isinstance(k, str) and _ERR.fullmatch(k) else "other"}
    return None


def _in(v, allowed: frozenset) -> bool:
    return isinstance(v, str) and v in allowed


def _step(s) -> int | None:
    """Wizard step 1..WIZARD_STEPS as int, else None."""
    if isinstance(s, bool) or not (
        isinstance(s, int) or (isinstance(s, str) and s.isascii() and s.isdigit())
    ):
        return None
    return int(s) if 1 <= int(s) <= WIZARD_STEPS else None


def _game(props: dict) -> dict | None:
    gid, res = props.get("id"), props.get("result")
    if not (_in(gid, GAME_IDS) and _in(res, GAME_RESULTS)):
        return None
    out = {"id": gid, "result": res}
    for key, allowed in (("duration_bucket", DURATION_BUCKETS), ("score_bucket", SCORE_BUCKETS)):
        v = props.get(key)
        if v is None:
            continue
        if not _in(v, allowed):
            return None
        out[key] = v
    return out


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
