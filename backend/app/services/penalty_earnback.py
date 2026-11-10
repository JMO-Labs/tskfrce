"""Penalties: earn-back slices, shorten, forgive, cancel, expiry (take-back side)."""

import json
from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from app.models.chores import ChoreRun
from app.models.family import get_family
from app.models.lock import Override
from app.models.penalty import Penalty
from app.models.points import Points, PointsType
from app.services import economy, screen_bank


def _naive(now: datetime) -> datetime:
    return now.astimezone(UTC).replace(tzinfo=None) if now.tzinfo else now


def _runs(db: Session, p: Penalty):
    return db.query(ChoreRun).filter(ChoreRun.penalty_id == p.id)


def _sync_overrides(db: Session, p: Penalty) -> None:
    """Device/group blocks carry Override rows; whole-kid blocks are read from the penalty."""
    db.query(Override).filter(Override.penalty_id == p.id).update({Override.expires_at: p.ends_at})


def _end(db: Session, p: Penalty, status: str, now: datetime) -> None:
    p.status, p.ended_at = status, _naive(now)
    db.query(Override).filter(Override.penalty_id == p.id).delete()
    _runs(db, p).filter(ChoreRun.status.in_(["todo", "submitted"])).update(
        {ChoreRun.status: "cancelled"}, synchronize_session=False
    )
    db.flush()


def on_approved(db: Session, run: ChoreRun) -> int:
    """A make-up run was approved: give back its slice. Returns the slice. Caller commits."""
    p = db.get(Penalty, run.penalty_id) if run.penalty_id else None
    if p is None or p.status != "active" or p.makeup_count < 1:
        return 0
    with economy.SPEND_LOCK:
        done = _runs(db, p).filter(ChoreRun.status == "done", ChoreRun.id != run.id).count()
        n = p.makeup_count
        slice_ = p.back_total // n + (p.back_total % n if done >= n - 1 else 0)
        slice_ = max(0, min(slice_, p.back_total - p.amount_returned))
        run.makeup_slice = slice_
        now = _naive(run.approved_at or datetime.now(UTC))
        if p.kind == "points" and slice_:
            note = f"Earned back: {run.assignment.chore.title}"
            db.add(
                Points(
                    user_id=p.kid_id,
                    points_type=PointsType.TRANSFER,
                    amount=slice_,
                    reason="penalty",
                    description=note,
                    penalty_id=p.id,
                    run_id=run.id,
                    seen_by_kid=False,
                )
            )
        elif p.kind == "screen" and slice_:
            screen_bank.put(db, p.kid_id, slice_)
        elif p.kind == "block" and p.ends_at:
            p.ends_at -= timedelta(minutes=slice_)
            _sync_overrides(db, p)
        p.amount_returned += slice_
        if p.kind == "block":
            over = bool(p.ends_at and p.ends_at <= now)
        else:
            over = done + 1 >= n
        if over:
            _end(db, p, "ended", now)
        db.flush()
        return slice_


def _block_overrides(db: Session, p: Penalty) -> None:
    """Re-create a reactivated device/group block's Override rows."""
    for dev_id in json.loads(p.device_ids or "[]"):
        db.add(
            Override(
                device_id=dev_id,
                action="lock",
                source="penalty",
                expires_at=p.ends_at,
                created_by_id=p.given_by_id,
                penalty_id=p.id,
            )
        )


def on_reverted(db: Session, run: ChoreRun, now: datetime) -> None:
    """An approved make-up run was taken back or undone: reverse its slice. Caller commits."""
    p = db.get(Penalty, run.penalty_id) if run.penalty_id else None
    slice_, run.makeup_slice = run.makeup_slice or 0, None
    if p is None or p.status == "cancelled" or not slice_:
        db.flush()
        return
    n = _naive(now)
    with economy.SPEND_LOCK:
        p.amount_returned = max(0, p.amount_returned - slice_)
        if p.kind == "points":
            db.query(Points).filter(Points.penalty_id == p.id, Points.run_id == run.id).delete()
        elif p.kind == "screen":
            screen_bank.take(db, get_family(db), p.kid_id, slice_)
        elif p.ends_at:
            p.ends_at += timedelta(minutes=slice_)
            _sync_overrides(db, p)
        if p.status == "ended" and p.ends_at and p.ends_at > n:
            p.status, p.ended_at = "active", None
            _runs(db, p).filter(ChoreRun.status == "cancelled", ChoreRun.id != run.id).update(
                {ChoreRun.status: "todo"}, synchronize_session=False
            )
            if p.kind == "block":
                _block_overrides(db, p)
        db.flush()


def shorten(db: Session, p: Penalty, minutes: int, now: datetime) -> None:
    if p.kind != "block" or p.status != "active":
        raise ValueError("Only an active block can be shortened.")
    with economy.SPEND_LOCK:
        p.ends_at -= timedelta(minutes=max(minutes, 0))
        _sync_overrides(db, p)
        if p.ends_at <= _naive(now):
            _end(db, p, "ended", now)
        db.commit()


def forgive(db: Session, p: Penalty, now: datetime) -> None:
    """Stop the penalty; taken points/time stay taken."""
    if p.status != "active":
        return
    with economy.SPEND_LOCK:
        _end(db, p, "forgiven", now)
        db.commit()


def cancel(db: Session, p: Penalty, now: datetime) -> None:
    """Undo it entirely: points ledger rows go, unreturned screen time is rebanked."""
    if p.status in ("cancelled", "forgiven"):
        return
    with economy.SPEND_LOCK:
        if p.kind == "points":
            db.query(Points).filter(Points.penalty_id == p.id).delete()
        elif p.kind == "screen" and p.amount_taken > p.amount_returned:
            screen_bank.put(db, p.kid_id, p.amount_taken - p.amount_returned)
        _end(db, p, "cancelled", now)
        db.commit()


def expire(db: Session, now: datetime) -> int:
    """End active penalties whose time is up. Flushes; the caller commits."""
    n = _naive(now)
    due = db.query(Penalty).filter(Penalty.status == "active", Penalty.ends_at <= n).all()
    for p in due:
        _end(db, p, "ended", now)
    return len(due)
