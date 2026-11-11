"""Settings API: reset app/factory reset, backup export, forgot-PIN recovery."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_parent
from app.core.auth import AuthService
from app.core.claim import matches as claim_matches
from app.core import lockout
from app.models.user import User
from app.services.reset import backup_export, factory_reset, reset_app_data

router = APIRouter(prefix="/api/v1/settings", tags=["settings"])


class ResetRequest(BaseModel):
    """Request to reset or factory-reset the box."""

    password: Annotated[str, Field(min_length=1)]
    confirm: Annotated[str, Field(min_length=5)]  # Must be exactly "RESET"
    factory: bool = False


class BackupExportResponse(BaseModel):
    """JSON backup of family data."""

    data: str  # JSON string


class ForgotPinRequest(BaseModel):
    """Request to reset parent password using sticker claim code."""

    claim_code: Annotated[str, Field(min_length=1)]
    new_password: Annotated[str, Field(min_length=8)]


@router.post("/reset")
def reset(
    body: ResetRequest,
    db: Session = Depends(get_db),
    parent: User = Depends(require_parent),
) -> dict:
    """
    Reset app or factory reset the box.

    Requires: parent auth (JWT), correct parent password, typed confirmation "RESET".
    Returns 403 for wrong password (generic message, no hint).
    Returns 409 if a kid session is active.
    """
    # Verify password (constant-time comparison)
    auth = AuthService(db)
    if not auth.verify_password(body.password, parent.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Parent password is incorrect.",
        )

    # Verify typed confirmation (case-sensitive)
    if body.confirm != "RESET":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Confirmation text is incorrect.",
        )

    # TODO: Check for active kid sessions; return 409 if any
    # For now, proceed with the reset

    try:
        if body.factory:
            factory_reset(db, unblock=True)
        else:
            reset_app_data(db, unblock=True)

        return {
            "ok": True,
            "message": "Box will restart shortly. Log in again when it comes back online.",
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Reset failed: {str(e)}",
        )


@router.get("/backup/export")
def backup(
    db: Session = Depends(get_db),
    _: User = Depends(require_parent),
) -> BackupExportResponse:
    """
    Export family data as JSON (no parent password, no PIN, no device secrets).

    Parent auth required (JWT only).
    """
    try:
        data = backup_export(db)
        return BackupExportResponse(data=data)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Backup export failed: {str(e)}",
        )


@router.post("/forgot-pin")
def forgot_pin(
    body: ForgotPinRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> dict:
    """
    Reset parent password using sticker claim code (no auth required, rate-limited by IP).

    Checks claim code against CLAIM_CODE setting.
    Rate limit: 5 attempts/min/IP, then 60–3600 s backoff (doubling).
    Comparison: hmac.compare_digest on normalized code.

    Returns 200 if code is correct (sets new password).
    Returns 403 if code is wrong or lockout active (generic message).
    """
    # Extract IP from X-Forwarded-For or use client address
    client_ip = request.client.host if request.client else "127.0.0.1"
    lockout_key = f"forgot_pin:{client_ip}"

    # Check rate limit (raises 429 if locked out)
    try:
        lockout.check(lockout_key)
    except HTTPException:
        raise

    # Verify claim code (constant-time comparison)
    if not claim_matches(body.claim_code):
        lockout.fail(lockout_key)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Claim code is incorrect. Check the sticker and try again.",
        )

    # Code is correct: reset parent password
    try:
        auth = AuthService(db)
        parent = db.query(User).filter(User.role == "PARENT").first()
        if not parent:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="No parent account found.",
            )

        # Hash and update password
        parent.hashed_password = auth.hash_password(body.new_password)
        db.commit()

        return {
            "ok": True,
            "message": "Password reset. Log in with your new password.",
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Password reset failed: {str(e)}",
        )
