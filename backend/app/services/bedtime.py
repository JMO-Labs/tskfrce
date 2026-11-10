"""Bedtime auto-approve: once a local day, chores still waiting for a parent approve themselves."""

from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.core.logging import get_logger
from app.models.chores import ChoreRun
from app.models.family import get_family
from app.services import chore_actions, inbox, trust
from app.services import chores as svc

log = get_logger(__name__)
EARLIEST, LATEST = 18 * 60, 23 * 60 + 30  # minutes after midnight
STEP = 15


def _mins(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def valid_at(at: str, reset_time: str) -> bool:
    """18:00..23:30 on a 15-minute step; a reset inside that range caps it 15 minutes before."""
    m, reset = _mins(at), _mins(reset_time)
    latest = reset - STEP if EARLIEST <= reset <= LATEST else LATEST
    return EARLIEST <= m <= latest and m % STEP == 0


def invalid_msg(reset_time: str) -> str:
    """Plain 12-hour 422 text for a bedtime the day reset does not allow."""
    reset = _mins(reset_time)
    latest = reset - STEP if EARLIEST <= reset <= LATEST else LATEST
    if latest < EARLIEST:
        return "Move the day reset later than 6:15 PM to use bedtime auto-approve."
    h, m = divmod(latest, 60)
    end = f"{h % 12 or 12}:{m:02d} {'PM' if h >= 12 else 'AM'}"
    return f"Pick a bedtime from 6:00 PM to {end}, in 15-minute steps, before the day resets."


def run(db: Session, now_utc: datetime) -> int:
    """Approve every waiting chore that isn't a spot check or 'Always check'. Returns the count."""
    fam = get_family(db)
    local = now_utc.astimezone(ZoneInfo(fam.timezone))
    if (
        not fam.bedtime_auto
        or fam.setup_step is not None
        or local.strftime("%H:%M") < fam.bedtime_auto_at
        or fam.bedtime_date == local.date()
    ):
        return 0
    fam.bedtime_date = local.date()
    n = 0
    for r in list(svc.waiting_runs(db)):
        if r.spot_check or svc.chore_of(r).always_check or trust.was_caught(db, r.id):
            continue
        try:
            with db.begin_nested():
                # compare-and-set so a parent approving right now cannot be paid twice
                won = (
                    db.query(ChoreRun)
                    .filter(ChoreRun.id == r.id, ChoreRun.status == "submitted")
                    .update({"status": "done"}, synchronize_session=False)
                )
                if won:
                    chore_actions.approve(db, r, None, via="bedtime")
                    n += 1
        except Exception:
            log.exception("bedtime approve failed for run %s", r.id)
    if n:
        inbox.notify(
            db, inbox.parents(db), "bedtime_done", f"Bedtime approved {n} chore{'s' * (n != 1)}."
        )
    return n
