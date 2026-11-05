"""Audit log of integration actions, keyed by idempotency key. Callers commit."""

from dataclasses import dataclass
from typing import Literal

from sqlalchemy.orm import Session

from app.models.integration import IntegrationAction, IntegrationInstall


@dataclass
class ActionResult:
    key: str
    result: Literal["applied", "pending", "rejected"]
    reason: str | None


def prior(db: Session, install_id: int, key: str) -> IntegrationAction | None:
    return db.query(IntegrationAction).filter_by(install_id=install_id, idempotency_key=key).first()


def record(
    db: Session,
    install: IntegrationInstall,
    kind: str,
    key: str,
    result: str,
    reason: str | None = None,
    **refs,
) -> IntegrationAction:
    """refs: kid_id, chore_id, run_id, redemption_id, and created_at to pin the time."""
    row = IntegrationAction(install_id=install.id, kind=kind[:24], idempotency_key=key)
    settle(row, result, reason, **refs)
    db.add(row)
    return row


def settle(row: IntegrationAction, result: str, reason: str | None = None, **refs) -> None:
    row.result, row.reason = result, reason[:200] if reason else None
    for k, v in refs.items():
        setattr(row, k, v)


def as_result(row: IntegrationAction) -> ActionResult:
    return ActionResult(row.idempotency_key, row.result, row.reason)
