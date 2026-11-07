"""auto boost and weekly surprise

Revision ID: z9c0d1e2f3a4
Revises: y8b9c0d1e2f3
Create Date: 2026-11-06 20:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "z9c0d1e2f3a4"
down_revision: str | Sequence[str] | None = "y8b9c0d1e2f3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# frozen copy of app.models.inbox.KINDS before this revision
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
    "password_guess",
    "workaround_try",
    "happy_hour",
)


def _kinds(kinds) -> None:
    with op.batch_alter_table("notifications") as b:
        b.drop_constraint("ck_notification_kind", type_="check")
        b.create_check_constraint(
            "ck_notification_kind", "kind IN (" + ",".join(f"'{k}'" for k in kinds) + ")"
        )


def upgrade() -> None:
    with op.batch_alter_table("family_settings") as b:
        b.add_column(sa.Column("hh_surprise_at", sa.DateTime(), nullable=True))
    _kinds((*OLD_INBOX, "boost"))


def downgrade() -> None:
    op.execute("DELETE FROM notifications WHERE kind = 'boost'")
    _kinds(OLD_INBOX)
    with op.batch_alter_table("family_settings") as b:
        b.drop_column("hh_surprise_at")
