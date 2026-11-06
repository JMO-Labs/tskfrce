"""Screen-time bank: unused daily room rolls over, up to a cap (time banking)."""

from datetime import datetime

from sqlalchemy.orm import Session

from app.lock.reset import clock_chore_day
from app.models.family import FamilySettings
from app.models.screen_bank import ScreenBank
from app.models.user import User, UserRole
from app.services import economy, screen_time


def _active(fam: FamilySettings) -> bool:
    return bool(fam.points_unlock_early and fam.screen_rollover)


def cap_for(db: Session, fam: FamilySettings, kid_id: int) -> int | None:
    """Most a kid can save: the family cap, or one day's max. None when there is no max."""
    daily_max, _ = screen_time.limit_for(db, fam, kid_id)
    if daily_max is None:
        return None
    return fam.screen_bank_cap or daily_max


def saved(db: Session, fam: FamilySettings, kid_id: int) -> int:
    """Effective bank, min(bank, cap); 0 when banking is off or there is no daily max."""
    cap = cap_for(db, fam, kid_id) if _active(fam) else None
    row = db.get(ScreenBank, kid_id)
    return min(row.minutes, cap) if cap is not None and row else 0


def settle(db: Session, fam: FamilySettings, now_utc: datetime) -> None:
    """Settle the old chore day (last_reset_date) into each kid's bank. Run before run_reset.
    Missed resets settle only that day; a fresh install skips; a settled day never repeats."""
    old = fam.last_reset_date
    new = clock_chore_day(fam, now_utc)
    if old is None or new <= old:
        return
    start = economy.deadline_utc(fam, old, fam.reset_time)
    end = economy.deadline_utc(fam, new, fam.reset_time)
    kids = [k.id for k in db.query(User.id).filter(User.role == UserRole.KID)]
    bought = screen_time.bought_between(db, kids, start, end)
    for kid_id in kids:
        row = db.get(ScreenBank, kid_id) or ScreenBank(kid_id=kid_id, minutes=0)
        if row.day == old:
            continue
        cap = cap_for(db, fam, kid_id) if _active(fam) else None
        if cap is None:
            row.minutes = 0
        else:
            daily_max, _ = screen_time.limit_for(db, fam, kid_id)
            row.minutes = max(0, min(cap, row.minutes + daily_max - bought[kid_id]))
        row.day = old
        db.add(row)
    db.flush()


def clear_all(db: Session) -> None:
    """Rollover turned off: every bank back to 0."""
    db.query(ScreenBank).update({ScreenBank.minutes: 0})
    db.flush()
