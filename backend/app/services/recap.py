"""Weekly recap: per-kid trends and flags for a Monday-Sunday week, computed on request."""

from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core.logging import get_logger
from app.models.chores import ChoreRun
from app.models.family import get_family
from app.models.points import Points, PointsType
from app.models.reward import Redemption
from app.models.trust import TrustEvent
from app.models.user import User, UserRole
from app.services import chores as svc
from app.services import economy, inbox, progression
from app.services.recap_flags import MIN_STREAK, flags

log = get_logger(__name__)
SEND_AT = "19:30"
SEND_CUTOFF = timedelta(hours=2)  # later than this after SEND_AT, skip the week
EARLIEST = date(2000, 1, 3)  # a Monday; earlier weeks have no data
WEEKS = 6  # 5 weeks of history plus the selected one


def latest_week(fam, now_utc: datetime) -> date:
    """Monday of the latest week that has ended, or ends today (Sunday)."""
    today = now_utc.astimezone(ZoneInfo(fam.timezone)).date()
    sunday = today - timedelta(days=(today.weekday() + 1) % 7)
    return sunday - timedelta(days=6)


def _utc(fam, d: date) -> datetime:
    local = datetime.combine(d, datetime.min.time(), tzinfo=ZoneInfo(fam.timezone))
    return local.astimezone(UTC).replace(tzinfo=None)


def _buckets(db, fam, kid_ids, start: date, end: date, now: datetime) -> dict[int, dict]:
    """Per kid and week (oldest first): chores assigned, done, and on-time / with-deadline."""
    b = {
        i: {"assigned": [0] * WEEKS, "done": [0] * WEEKS, "ontime": [(0, 0)] * WEEKS}
        for i in kid_ids
    }
    runs = (
        db.query(ChoreRun)
        .options(
            joinedload(ChoreRun.assignment),
            joinedload(ChoreRun.approved_by),
            selectinload(ChoreRun.kids),
        )
        .filter(
            ChoreRun.day >= start,
            ChoreRun.day <= end,
            ChoreRun.status.notin_(["cancelled", "skipped"]),
        )
        .all()
    )
    for r in runs:
        w = (r.day - start).days // 7
        done = svc.state(r) == "done"
        due = economy.deadline_utc(fam, r.day, r.assignment.due_time)
        sent = r.submitted_at or r.approved_at
        counts = due is not None and (r.status in ("done", "submitted") or due < now)
        for k in svc.run_kid_ids(r):
            if k not in b:
                continue
            b[k]["assigned"][w] += 1
            b[k]["done"][w] += done
            if counts:
                o, t = b[k]["ontime"][w]
                b[k]["ontime"][w] = (o + (sent is not None and sent <= due), t + 1)
    return b


def _sums(db, col, kid_col, ids, *where) -> dict[int, int]:
    q = db.query(kid_col, func.coalesce(func.sum(col), 0)).filter(kid_col.in_(ids), *where)
    return dict(q.group_by(kid_col).all())


def week_of(db: Session, week_start: date | None = None, now_utc: datetime | None = None) -> dict:
    fam = get_family(db)
    now_utc = now_utc or datetime.now(UTC)
    latest = latest_week(fam, now_utc)
    if week_start:
        week_start = max(week_start, EARLIEST)
        week_start -= timedelta(days=week_start.weekday())
    ws = min(week_start, latest) if week_start else latest
    we = ws + timedelta(days=6)
    kids = db.query(User).filter(User.role == UserRole.KID, User.is_active).order_by(User.id).all()
    ids = [k.id for k in kids]
    out = {
        "week_start": ws.isoformat(),
        "week_end": we.isoformat(),
        "prev": (ws - timedelta(days=7)).isoformat() if ws > EARLIEST else None,
        "next": (ws + timedelta(days=7)).isoformat() if ws < latest else None,
        "kids": [],
        "family_line": None,
        "all_good": True,
    }
    if not ids:
        return out
    lo, hi = _utc(fam, ws), _utc(fam, we + timedelta(days=1))
    b = _buckets(db, fam, ids, ws - timedelta(weeks=WEEKS - 1), we, now_utc.replace(tzinfo=None))
    days = progression.chore_days_many(db, ids, we)
    chore_today = svc.today(db, now_utc)  # the chore day, not the calendar date

    def streak(kid, end):  # a finished day that was missed breaks it; an open day pauses it
        asof = end + timedelta(days=1) if end < chore_today else end
        part = {d: v for d, v in days[kid].items() if d <= end}
        return progression.streak_for(part, asof, fam.streak_freeze).current

    earned = _sums(
        db, Points.amount, Points.user_id, ids,
        Points.amount > 0, Points.points_type != PointsType.TRANSFER,
        Points.created_at >= lo, Points.created_at < hi,
    )  # fmt: skip
    in_week = (
        Redemption.status == "approved",
        Redemption.decided_at >= lo,
        Redemption.decided_at < hi,
    )
    spent = _sums(db, Redemption.cost, Redemption.kid_id, ids, *in_week)
    mins = _sums(
        db, Redemption.minutes, Redemption.kid_id, ids,
        Redemption.kind == "screen_time", *in_week,
    )  # fmt: skip
    catches = dict(
        db.query(TrustEvent.kid_id, func.count())
        .filter(
            TrustEvent.kid_id.in_(ids),
            TrustEvent.kind == "catch",
            TrustEvent.at >= lo,
            TrustEvent.at < hi,
        )
        .group_by(TrustEvent.kid_id)
        .all()
    )
    for k in kids:
        x = b[k.id]
        name = k.full_name or k.username
        history = sum(1 for a in x["assigned"][:5] if a) >= 2
        steps = [streak(k.id, ws - timedelta(days=1) + timedelta(days=i)) for i in range(8)]
        ended = max(
            (a for a, c in zip(steps, steps[1:], strict=False) if c < a and a >= MIN_STREAK),
            default=0,
        )
        now_streak = steps[-1]
        fl = flags(name, x, catches.get(k.id, 0), ended, history)
        o, t = x["ontime"][5]
        base = [100 * o2 / t2 for o2, t2 in x["ontime"][1:5] if t2]
        out["kids"].append(
            {
                "id": k.id,
                "name": name,
                "flags": fl,
                "done": x["done"][5],
                "done_trend": x["done"][1:],
                "on_time_pct": round(100 * o / t) if t else None,
                "on_time_avg": round(sum(base) / len(base)) if base else None,
                "points_earned": earned.get(k.id, 0),
                "points_spent": spent.get(k.id, 0),
                "screen_minutes_bought": mins.get(k.id, 0),
                "streak": now_streak,
                "enough_history": history,
            }
        )
    out["all_good"] = not any(k["flags"] for k in out["kids"])
    totals = [sum(b[i]["done"][w] for i in ids) for w in range(1, WEEKS)]
    if totals[-1] and all(totals[-1] > t for t in totals[:-1]):
        out["family_line"] = "Best week in a month."
    return out


def _body(lines: list[str], limit: int = 300) -> str:
    """Whole lines up to the limit, then "and N more"."""
    if not lines:
        return "All good this week"
    for n in range(len(lines), 0, -1):
        text = "\n".join(lines[:n]) + (f"\nand {len(lines) - n} more" if n < len(lines) else "")
        if len(text) <= limit:
            return text
    return f"{len(lines)} things to look at"


def send(db: Session, now_utc: datetime) -> None:
    """Sunday 19:30 local, once per day, skipped if the box was down for over 2 hours."""
    fam = get_family(db)
    local = now_utc.astimezone(ZoneInfo(fam.timezone))
    if (
        not fam.recap_weekly
        or fam.setup_step is not None
        or local.weekday() != 6
        or local.strftime("%H:%M") < SEND_AT
        or fam.recap_date == local.date()
    ):
        return
    fam.recap_date = local.date()
    h, m = map(int, SEND_AT.split(":"))
    if local - local.replace(hour=h, minute=m, second=0, microsecond=0) > SEND_CUTOFF:
        return
    data = week_of(db, local.date() - timedelta(days=6), now_utc)
    lines = [f["text"] for k in data["kids"] for f in k["flags"]]
    inbox.notify_parents(db, "recap", f"Your week at {fam.name}"[:120], _body(lines))
