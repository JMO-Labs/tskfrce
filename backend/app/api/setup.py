"""First-run setup: create the owner parent and family."""

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_parent
from app.core import claim, lockout
from app.core.auth import AuthService
from app.core.client_ip import client_ip
from app.core.config import settings
from app.core.ratelimit import limit
from app.lock.reset import clock_chore_day
from app.models.family import FamilySettings, get_family, owner_set
from app.models.user import User, UserRole
from app.schemas.password import Password
from app.services.chore_types import seed as seed_chore_types

router = APIRouter(prefix="/api/v1/setup", tags=["setup"])

DONE = "Setup is already done. Log in instead."
FINISHED = "Setup is already finished."
RESUME_AFTER_ACCOUNT = 3  # the account exists from step 2 on; the wizard resumes at step 3
LAST_STEP = 7
CLAIM_WRONG = "That code doesn't match this box. Check the sticker and try again."


class ParentIn(BaseModel):
    username: str = Field(min_length=3, max_length=50, pattern=r"^[a-zA-Z0-9_.-]+$")
    password: Password
    full_name: str = Field(max_length=100)


class SetupIn(BaseModel):
    family_name: str = Field(min_length=1, max_length=100)
    timezone: str = "UTC"
    parent: ParentIn
    claim_code: str | None = Field(None, max_length=32)

    @field_validator("timezone")
    @classmethod
    def _known_tz(cls, v: str) -> str:
        try:
            ZoneInfo(v)
        except Exception:
            raise ValueError("Unknown time zone.") from None
        return v


def _now() -> datetime:
    return datetime.now(UTC)


def _start_chore_day(fam: FamilySettings) -> None:
    """Chore day = today in the family's zone, so the next reset is the first one after now."""
    fam.last_reset_date = clock_chore_day(fam, _now())


def claim_owner(db: Session, user_id: int, name: str, tz: str) -> int:
    """Compare-and-set on owner_id is the lock: only one setup can win (returns 1)."""
    return db.execute(
        update(FamilySettings)
        .where(FamilySettings.id == 1, FamilySettings.owner_id.is_(None))
        .values(
            owner_id=user_id,
            name=name,
            timezone=tz,
            setup_step=RESUME_AFTER_ACCOUNT,
            points_unlock_early=True,  # new families only; existing ones keep their choice
        )
    ).rowcount


@router.get("")
def setup_needed(db: Session = Depends(get_db)):
    return {
        "needed": db.query(User.id).first() is None and not owner_set(db),
        "claim": claim.required(db),
    }


class ClaimIn(BaseModel):
    code: str = Field(max_length=32)


def _check_claim(request: Request, code: str | None) -> None:
    """Lockout check, then compare; a wrong code is a strike. Never echo the code."""
    key = f"claim:{client_ip(request)}"
    lockout.check(key)
    if not claim.matches(code):
        lockout.fail(key)
        raise HTTPException(status.HTTP_403_FORBIDDEN, CLAIM_WRONG)


@router.post("/claim", status_code=status.HTTP_204_NO_CONTENT)
def check_claim(body: ClaimIn, request: Request, db: Session = Depends(get_db)):
    if db.query(User.id).first() is not None or owner_set(db):
        raise HTTPException(status.HTTP_409_CONFLICT, DONE)
    if claim.required(db):
        _check_claim(request, body.code)


class StepIn(BaseModel):
    step: int | None = Field(None, ge=RESUME_AFTER_ACCOUNT, le=LAST_STEP)  # None = wizard finished


@router.get("/step")
def get_step(db: Session = Depends(get_db), _: User = Depends(require_parent)):
    """The wizard step an unfinished setup should resume at (None = nothing to resume)."""
    step = get_family(db).setup_step
    # anything past the last step counts as finished
    return {"step": step if step is None or step <= LAST_STEP else None}


@router.put("/step")
def put_step(body: StepIn, db: Session = Depends(get_db), _: User = Depends(require_parent)):
    fam = get_family(db)
    if body.step is not None and fam.setup_step is None:
        raise HTTPException(status.HTTP_409_CONFLICT, FINISHED)  # no reopening: runs would stop
    if body.step is None and fam.setup_step is not None:
        _start_chore_day(fam)  # Finish: wizard chores start at the next reset, not tonight
    fam.setup_step = body.step
    db.commit()
    return {"step": body.step}


def _limit_setup(request: Request) -> None:
    limit(f"setup:{client_ip(request)}", 5, 60)


@router.post("", status_code=status.HTTP_201_CREATED, dependencies=[Depends(_limit_setup)])
def run_setup(body: SetupIn, request: Request, db: Session = Depends(get_db)):
    if db.query(User.id).first() is not None or owner_set(db):
        raise HTTPException(status.HTTP_409_CONFLICT, DONE)
    if claim.required(db):
        _check_claim(request, body.claim_code)
    auth = AuthService(db)
    try:
        try:
            get_family(db)
            seed_chore_types(db)
        except IntegrityError:  # concurrent insert of row id=1
            db.rollback()
        user = User(
            username=body.parent.username,
            email=f"{body.parent.username}@family.local",
            hashed_password=auth.get_password_hash(body.parent.password),
            full_name=body.parent.full_name,
            role=UserRole.PARENT,
            is_superuser=True,
        )
        db.add(user)
        db.flush()
        won = claim_owner(db, user.id, body.family_name, body.timezone)
        if won != 1:
            db.rollback()
            raise HTTPException(status.HTTP_409_CONFLICT, DONE)
        fam = get_family(db)
        db.refresh(fam)
        _start_chore_day(fam)  # in the new time zone; the unclaimed box ticked in UTC
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, DONE) from None
    # Create tokens with token_epoch (0 at setup time)
    token = auth.create_access_token(
        data={
            "sub": str(user.id),
            "username": user.username,
            "email": user.email,
            "token_epoch": 0,
        },
        expires_delta=timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
    )
    refresh = auth.create_refresh_token(
        data={
            "sub": str(user.id),
            "username": user.username,
            "email": user.email,
            "token_epoch": 0,
        },
        expires_delta=timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
    )
    return {
        "access_token": token,
        "refresh_token": refresh,
        "token_type": "bearer",
        "expires_in": settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        "refresh_expires_in": settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
    }
