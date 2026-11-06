from datetime import UTC, date, datetime, timedelta

from app.lock import state
from app.models.family import get_family
from app.models.points import Points, PointsType
from app.models.reward import Redemption
from app.models.screen_bank import ScreenBank
from app.services import screen_bank

D = date(2026, 11, 2)
START = datetime(2026, 11, 2, 6, 0)  # D's reset, naive UTC
NEXT = START + timedelta(days=1)  # the reset that settles D


def _fam(db, kid, **kw):
    fam = get_family(db)
    fam.timezone = "UTC"
    fam.reset_time = "06:00"
    fam.points_unlock_early = True
    fam.screen_max_minutes = 60
    fam.last_reset_date = D
    for k, v in kw.items():
        setattr(fam, k, v)
    db.add(Points(user_id=kid.id, points_type=PointsType.BONUS, amount=500, description="t"))
    db.commit()
    return fam


def _red(db, kid, minutes, created, status="approved"):
    db.add(
        Redemption(
            kid_id=kid.id,
            kind="screen_time",
            minutes=minutes,
            cost=minutes // 15 * 20,
            status=status,
            created_at=created,
        )
    )
    db.commit()


def _bank(db, kid, minutes, day=None):
    db.add(ScreenBank(kid_id=kid.id, minutes=minutes, day=day))
    db.commit()


def _settle(db, fam, now=NEXT + timedelta(seconds=30)):
    screen_bank.settle(db, fam, now.replace(tzinfo=UTC))
    db.commit()


def _minutes(db, kid):
    row = db.get(ScreenBank, kid.id)
    return row.minutes if row else 0


def test_quiet_day_banks_unused_room(db, kid):
    fam = _fam(db, kid)
    _red(db, kid, 15, START - timedelta(minutes=1))  # previous day: ignored
    _red(db, kid, 20, START + timedelta(hours=2))
    _red(db, kid, 30, NEXT + timedelta(seconds=5))  # new day: ignored (upper bound)
    _settle(db, fam)
    assert _minutes(db, kid) == 40
    assert db.get(ScreenBank, kid.id).day == D
    assert screen_bank.saved(db, fam, kid.id) == 40


def test_accumulates_to_cap(db, kid):
    fam = _fam(db, kid)
    _settle(db, fam)
    fam.last_reset_date = D + timedelta(days=1)
    _settle(db, fam, NEXT + timedelta(days=1, seconds=30))
    assert _minutes(db, kid) == 60
    assert screen_bank.cap_for(db, fam, kid.id) == 60


def test_spending_beyond_max_uses_bank(db, kid):
    fam = _fam(db, kid)
    _bank(db, kid, 60)
    _red(db, kid, 120, START + timedelta(hours=1))
    _settle(db, fam)
    assert _minutes(db, kid) == 0


def test_never_below_zero(db, kid):
    fam = _fam(db, kid)
    _bank(db, kid, 15)
    _red(db, kid, 120, START + timedelta(hours=1))
    _settle(db, fam)
    assert _minutes(db, kid) == 0


def test_pending_counts_as_used(db, kid):
    fam = _fam(db, kid)
    _red(db, kid, 30, START + timedelta(hours=1), status="pending")
    _red(db, kid, 15, START + timedelta(hours=2), status="denied")
    _settle(db, fam)
    assert _minutes(db, kid) == 30


def test_double_settle_is_idempotent(db, kid):
    fam = _fam(db, kid, screen_bank_cap=240)
    _settle(db, fam)
    _settle(db, fam)
    assert _minutes(db, kid) == 60


def test_tick_twice_credits_once(db, kid):
    fam = _fam(db, kid, screen_bank_cap=240)
    state.tick(db, (NEXT + timedelta(seconds=10)).replace(tzinfo=UTC))
    state.tick(db, (NEXT + timedelta(seconds=40)).replace(tzinfo=UTC))
    assert _minutes(db, kid) == 60
    assert fam.last_reset_date == D + timedelta(days=1)


def test_missed_resets_settle_only_old_day(db, kid):
    fam = _fam(db, kid, screen_bank_cap=480)
    _red(db, kid, 15, START + timedelta(days=2))  # box off, still counted against D
    _settle(db, fam, NEXT + timedelta(days=2, minutes=1))
    assert _minutes(db, kid) == 45


def test_fresh_install_skips(db, kid):
    fam = _fam(db, kid, last_reset_date=None)
    _settle(db, fam)
    assert db.get(ScreenBank, kid.id) is None


def test_lowered_max_caps_at_read_time(db, kid):
    fam = _fam(db, kid)
    _bank(db, kid, 60)
    fam.screen_max_minutes = 30
    db.commit()
    assert screen_bank.saved(db, fam, kid.id) == 30


def test_max_cleared_zeroes_bank(db, kid):
    fam = _fam(db, kid)
    _bank(db, kid, 60)
    fam.screen_max_minutes = None
    db.commit()
    assert screen_bank.saved(db, fam, kid.id) == 0
    assert screen_bank.cap_for(db, fam, kid.id) is None
    _settle(db, fam)
    assert _minutes(db, kid) == 0


def test_screen_time_off_banks_nothing(db, kid):
    fam = _fam(db, kid, points_unlock_early=False)
    _settle(db, fam)
    assert _minutes(db, kid) == 0
    assert screen_bank.saved(db, fam, kid.id) == 0


def test_rollover_off_banks_nothing(db, kid):
    fam = _fam(db, kid, screen_rollover=False)
    _settle(db, fam)
    assert _minutes(db, kid) == 0
    assert screen_bank.saved(db, fam, kid.id) == 0


def test_clear_all(db, kid):
    _fam(db, kid)
    _bank(db, kid, 45)
    screen_bank.clear_all(db)
    db.commit()
    assert _minutes(db, kid) == 0


def test_check_allows_max_plus_saved(db, kid):
    import pytest
    from app.services import screen_time
    from fastapi import HTTPException

    fam = _fam(db, kid, last_reset_date=None)
    _bank(db, kid, 45)
    now = datetime(2026, 11, 3, 12, 0, tzinfo=UTC)  # fixed
    _red(db, kid, 60, screen_time.day_start_utc(fam, now) + timedelta(seconds=1))

    with pytest.raises(HTTPException) as e:
        screen_time.check(db, fam, kid, 60, now)
    assert e.value.detail == "That's over today's limit. You can buy 45 more minutes today."
    screen_time.check(db, fam, kid, 45, now)  # exactly the saved room
    _red(db, kid, 45, now.replace(tzinfo=None))
    with pytest.raises(HTTPException) as e:
        screen_time.check(db, fam, kid, 15, now)
    assert e.value.detail == "You've had all your screen time for today."


def test_settle_across_fall_back_day(db, kid):
    # 2026-11-01 in New York is 25 hours long; settling it must still credit unused room.
    D1 = date(2026, 11, 1)
    fam = _fam(db, kid, timezone="America/New_York", last_reset_date=D1)
    start = datetime(2026, 11, 1, 10, 0)  # 06:00 EDT (UTC-4)
    end = datetime(2026, 11, 2, 11, 0)  # 06:00 EST (UTC-5): 25h later
    _red(db, kid, 20, start + timedelta(hours=24, minutes=30))  # in the extra hour, still day D1
    _red(db, kid, 15, end + timedelta(minutes=1))  # next day: ignored
    _settle(db, fam, end + timedelta(seconds=30))
    assert _minutes(db, kid) == 40
    assert db.get(ScreenBank, kid.id).day == D1



def test_lowered_max_does_not_refund_spent_bank(db, kid):
    # Bank 60, max lowered 60 -> 30, kid buys 60 (max 30 + saved 30): nothing is left.
    fam = _fam(db, kid)
    _bank(db, kid, 60)
    fam.screen_max_minutes = 30
    db.commit()
    assert screen_bank.saved(db, fam, kid.id) == 30
    _red(db, kid, 60, START + timedelta(hours=1))
    _settle(db, fam)
    assert _minutes(db, kid) == 0



def test_settle_skipped_during_setup(db, kid):
    fam = _fam(db, kid, setup_step=1)
    _settle(db, fam)
    assert db.get(ScreenBank, kid.id) is None
