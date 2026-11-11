"""box_update notification kind

Revision ID: c3dbbe83435f
Revises: b3n4o5p6q7r8
Create Date: 2026-11-11 13:38:47.660787

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c3dbbe83435f"
down_revision: str | Sequence[str] | None = "b3n4o5p6q7r8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# frozen copy of app.models.inbox.KINDS at this revision's parent
BEFORE = (
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
    "password_guess",
    "workaround_try",
    "happy_hour",
    "boost",
    "trust_up",
    "trust_down",
    "bedtime_done",
    "recap",
    "homework_request",
    "goal_full",
    "goal_suggested",
    "jail_card",
)
AFTER = BEFORE + ("box_update",)


def _set_kinds(kinds: tuple[str, ...]) -> None:
    with op.batch_alter_table("notifications", schema=None) as batch_op:
        batch_op.drop_constraint("ck_notification_kind", type_="check")
        batch_op.create_check_constraint(
            "ck_notification_kind", "kind IN (" + ",".join(f"'{k}'" for k in kinds) + ")"
        )


def upgrade() -> None:
    _set_kinds(AFTER)


def downgrade() -> None:
    op.execute("DELETE FROM notifications WHERE kind = 'box_update'")
    _set_kinds(BEFORE)
