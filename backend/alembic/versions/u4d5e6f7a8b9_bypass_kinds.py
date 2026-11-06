"""bypass alert kinds

Revision ID: u4d5e6f7a8b9
Revises: o2b3c4d5e6f7
Create Date: 2026-11-05 15:00:00.000000
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "u4d5e6f7a8b9"
down_revision: str | Sequence[str] | None = "o2b3c4d5e6f7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

OLD_EVENT = (
    "bypass",
    "new_address",
    "outside_hours",
    "locked_try",
    "left_wifi",
    "sign_in",
    "address_change",
    "locked",
    "unlocked",
)
NEW_EVENT = ("identity_change", "workaround_try")
OLD_INBOX = (
    "chore_submitted",
    "redemption_request",
    "redemption_decided",
    "device_resisting",
    "new_device",
    "device_hint",
    "badge_earned",
    "level_up",
    "chat_message",
    "chore_note",
    "chore_new",
    "due_soon",
    "missed_deadline",
    "chore_approved",
    "chore_sent_back",
    "points_taken",
    "lock_warning",
    "device_bypass",
    "box_offline",
    "integration_done",
    "integration_msg",
    "integration_paused",
)
NEW_INBOX = ("password_guess", "workaround_try")


def _check(kinds) -> str:
    return "kind IN (" + ",".join(f"'{k}'" for k in kinds) + ")"


def _swap(table: str, name: str, kinds) -> None:
    with op.batch_alter_table(table) as b:
        b.drop_constraint(name, type_="check")
        b.create_check_constraint(name, _check(kinds))


def upgrade() -> None:
    _swap("device_events", "ck_device_event_kind", (*OLD_EVENT, *NEW_EVENT))
    _swap("notifications", "ck_notification_kind", (*OLD_INBOX, *NEW_INBOX))


def downgrade() -> None:
    op.execute("DELETE FROM device_events WHERE kind IN ('" + "','".join(NEW_EVENT) + "')")
    op.execute("DELETE FROM notifications WHERE kind IN ('" + "','".join(NEW_INBOX) + "')")
    _swap("device_events", "ck_device_event_kind", OLD_EVENT)
    _swap("notifications", "ck_notification_kind", OLD_INBOX)
