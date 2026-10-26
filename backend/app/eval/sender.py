"""Forward the eval outbox to Umami (stats) and Supabase (feedback)."""

import logging
import time
from pathlib import Path

import httpx

from app.core.config import settings
from app.eval import store
from app.eval.config import eval_settings, feedback_on, stats_on

log = logging.getLogger(__name__)

UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0 Safari/537.36 task4ce-eval"
)
DUMMY_IP = "192.0.2.1"
IP_HEADER = "X-Eval-Client-IP"
BUCKET = "feedback-shots"
SHOTS_DIR = "eval-shots"
_MIME = {"png": "image/png", "jpg": "image/jpeg", "webp": "image/webp"}


def send_umami(body: dict) -> str:
    try:
        r = httpx.post(
            f"{eval_settings.EVAL_UMAMI_URL.rstrip('/')}/api/send",
            json=body,
            headers={
                "User-Agent": UA,
                IP_HEADER: DUMMY_IP,
                "x-umami-website-id": eval_settings.EVAL_UMAMI_WEBSITE_ID,
            },
            timeout=10,
        )
    except Exception as e:
        log.warning("eval umami send failed: %s", type(e).__name__)
        return "retry"
    if r.is_success:
        try:
            if "beep" in r.json():
                log.warning("eval umami answered with a bot response")
        except Exception:
            pass
        return "ok"
    if 400 <= r.status_code < 500:
        log.warning("eval umami rejected event: %s", r.status_code)
        return "drop"
    log.warning("eval umami error: %s", r.status_code)
    return "retry"


def _uploaded(r: httpx.Response) -> bool:
    if r.is_success or r.status_code == 409:
        return True
    return r.status_code == 400 and ("Duplicate" in r.text or "already exists" in r.text)


def _send_feedback(body: dict) -> str:
    base = eval_settings.EVAL_SUPABASE_URL.rstrip("/")
    key = eval_settings.EVAL_SUPABASE_ANON_KEY
    auth = {"apikey": key, "Authorization": f"Bearer {key}"}
    shots_dir = Path(settings.DATA_DIR) / SHOTS_DIR
    paths, files = [], []
    for i, name in enumerate(body.get("shots", [])):
        ext = name.rsplit(".", 1)[-1].lower()
        path = f"{body['household']}/{body['id']}-{i}.{ext}"
        paths.append(path)
        f = shots_dir / name
        if not f.is_file():
            continue
        r = httpx.post(
            f"{base}/storage/v1/object/{BUCKET}/{path}",
            content=f.read_bytes(),
            headers={**auth, "Content-Type": _MIME.get(ext, "application/octet-stream")},
            timeout=30,
        )
        if not _uploaded(r):
            log.warning("eval feedback upload failed: %s", r.status_code)
            return "retry"
        files.append(f)
    row = {k: v for k, v in body.items() if k != "shots"}
    row["screenshot_paths"] = paths
    r = httpx.post(
        f"{base}/rest/v1/feedback",
        json=row,
        headers={**auth, "Content-Type": "application/json", "Prefer": "return=minimal"},
        timeout=10,
    )
    if not (r.is_success or r.status_code == 409):
        log.warning("eval feedback insert failed: %s", r.status_code)
        return "retry"
    for f in files:
        f.unlink(missing_ok=True)
    return "ok"


def send_feedback(body: dict) -> str:
    try:
        return _send_feedback(body)
    except Exception as e:
        log.warning("eval feedback send failed: %s", type(e).__name__)
        return "retry"


def flush(now: float | None = None) -> int:
    try:
        now = time.time() if now is None else now
        store.prune(now)
        n = 0
        for row in store.due(now):
            if row.kind == "umami" and stats_on():
                res = send_umami(row.body)
            elif row.kind == "feedback" and feedback_on():
                res = send_feedback(row.body)
            else:
                continue
            if res == "retry":
                store.failed(row.id, row.attempts + 1, now)
                break
            store.sent(row.id)
            n += 1
        return n
    except Exception as e:
        log.warning("eval flush failed: %s", type(e).__name__)
        return 0
