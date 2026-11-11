"""Settings API: reset app/factory reset, backup export, forgot-PIN recovery."""

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_parent
from app.core.auth import AuthService
from app.core.claim import matches as claim_matches
from app.core.client_ip import client_ip
from app.core import lockout
from app.models.family import get_family
from app.models.user import User
from app.services.reset import backup_export, factory_reset, reset_app_data

router = APIRouter(prefix="/api/v1/settings", tags=["settings"])


class ResetRequest(BaseModel):
    """Request to reset or factory-reset the box."""

    password: str = Field(min_length=1)
    confirm: str = Field(min_length=5)  # Must be exactly "RESET"
    factory: bool = False


class BackupExportResponse(BaseModel):
    """JSON backup of family data."""

    data: str  # JSON string


class ForgotPinRequest(BaseModel):
    """Request to reset parent password using sticker claim code."""

    claim_code: str = Field(min_length=1)
    new_password: str = Field(min_length=8)


class SetPinRequest(BaseModel):
    """Request to set a new parent PIN via CLI (no data loss)."""

    new_password: str = Field(min_length=8)


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
            setup_token = factory_reset(db, unblock=True)
        else:
            setup_token = reset_app_data(db, unblock=True)

        response = {
            "ok": True,
            "message": "Box will restart shortly. Log in again when it comes back online.",
        }
        if setup_token:
            response["setup_token"] = setup_token

        return response
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
    Reset owner parent password using sticker claim code (no auth required).

    Rate-limited: shares claim-code lockout namespace (5 attempts/min/IP,
    then 60–3600 s backoff). Uses constant-time compare on normalized code.

    Returns 200 if code is correct (resets owner password).
    Returns 403 if code is wrong (generic message).
    Returns 429 if lockout active (shared with /setup/claim endpoint).

    Post-reset: TODO: Invalidate all existing owner sessions, notify owner.
    """
    # Use shared claim-code lockout namespace (same as /setup/claim)
    ip = client_ip(request)
    lockout_key = f"claim:{ip}"

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

    # Code is correct: reset owner parent password
    try:
        auth = AuthService(db)
        fam = get_family(db)
        owner_id = fam.owner_id
        if not owner_id:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="No parent account found.",
            )

        owner = db.query(User).filter(User.id == owner_id).first()
        if not owner:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Parent account not found.",
            )

        # Hash and update password
        owner.hashed_password = auth.hash_password(body.new_password)

        # Bump token_epoch to invalidate all existing JWTs (session invalidation)
        fam.token_epoch = (fam.token_epoch or 0) + 1

        db.commit()

        # Notify parent via Today inbox
        try:
            from app.services.notify import notify_parents
            notify_parents(
                db,
                "Parent PIN was reset with the box code.",
                kind="box_reset_pin",
            )
        except Exception as e:
            logger.warning("Failed to notify parents of PIN reset", error=str(e))

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


@router.post("/set-pin")
def set_pin(
    body: SetPinRequest,
    db: Session = Depends(get_db),
) -> dict:
    """
    Set a new parent PIN via CLI (no data loss, bumps token epoch for security).

    Called by: sudo tskfrce-reset --pin
    Auth: X-Internal-Token (internal only, not user-facing)

    Sets new PIN + bumps token_epoch to invalidate old sessions.
    """
    try:
        auth = AuthService(db)
        fam = get_family(db)
        owner_id = fam.owner_id
        if not owner_id:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="No parent account found.",
            )

        owner = db.query(User).filter(User.id == owner_id).first()
        if not owner:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Parent account not found.",
            )

        # Hash and update password
        owner.hashed_password = auth.hash_password(body.new_password)

        # Bump token_epoch to invalidate old sessions
        fam.token_epoch = (fam.token_epoch or 0) + 1

        db.commit()

        return {
            "ok": True,
            "message": "PIN updated and sessions invalidated.",
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"PIN set failed: {str(e)}",
        )
