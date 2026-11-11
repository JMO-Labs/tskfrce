"""Chore state changes shared by the parent, kid and integration paths. Callers commit."""

from datetime import datetime

from sqlalchemy.orm import Session, object_session

from app.models.chores import ChoreRun, RunStepTick
from app.models.family import get_family
from app.services import badges, chat, happy_hour, kid_events, minigames, trust
from app.services import chores as svc
from app.services.economy import _recipients, award_chore


def tick_all(run: ChoreRun, by_id: int | None, now: datetime) -> None:
    have = {t.step_id for t in run.ticks}
    for s in svc.chore_of(run).steps:
        if s.id not in have:
            run.ticks.append(RunStepTick(step_id=s.id, done_by_id=by_id, done_at=now))


def claim(db: Session, run: ChoreRun, frm: str = "todo", to: str = "submitted") -> bool:
    """Compare-and-set frm -> to, so a racing decision cannot pay twice."""
    n = (
        db.query(ChoreRun)
        .filter(ChoreRun.id == run.id, ChoreRun.status == frm)
        .update({"status": to}, synchronize_session=False)
    )
    return n == 1


def submit(run: ChoreRun, by_id: int | None, now: datetime) -> None:
    run.status = "submitted"
    run.submitted_at = now
    run.submitted_by_id = by_id
    # team runs pay every member, so only an all-kids Happy Hour may apply (None = all-kids)
    who = None if run.kid_id is None and run.assignment.mode == "team" else by_id
    hh = happy_hour.active_for(object_session(run), who, now)
    run.hh_mult_x10 = hh.mult_x10 if hh else None


def approve(db: Session, run: ChoreRun, by_id: int | None, via: str = "parent") -> int:
    """via: parent | trust | bedtime | integration. Integrations don't count toward trust."""
    run.status = "done"
    run.approved_at = run.completed_at = datetime.utcnow()
    run.approved_by_id = by_id
    run.approved_via = via
    svc.clear_note(run)
    fam = get_family(db)
    pts = award_chore(db, run, fam)
    if run.penalty_id:
        from app.services import penalty_earnback

        penalty_earnback.on_approved(db, run)
    minigames.earn(db, run, fam)  # skips make-up (penalty) runs itself
    chat.system(db, run, f"Approved · +{pts}")
    badges.check_for_run(db, run, fam)
    if via != "integration":
        trust.count_clean(db, trust.payees(run))
    kid_events.chore_decided(db, run, True)
    from app.integrations import events  # events -> apply -> this module

    c = svc.chore_of(run)
    events.emit(db, "chore.completed", _recipients(run), chore_id=c.id, title=c.title, points=pts)
    return pts


def send_back(db: Session, run: ChoreRun, note: str, by_id: int | None = None) -> None:
    run.status = "todo"
    run.attempt = (run.attempt or 1) + 1
    run.last_note = note
    submitter = run.submitted_by_id
    if run.spot_check:  # a spot-checked chore sent back is a catch
        trust.catch_run(db, run, by_id, lower=True)
        run.spot_check = False
    run.submitted_at = run.submitted_by_id = run.hh_mult_x10 = None
    chat.system(db, run, f"Sent back: {note}")
    kid_events.chore_decided(db, run, False, note, submitter)
