"""homework mode: sites, requests, activity, override and notification kinds

Revision ID: w1a2b3c4d5e6
Revises: f1a2b3c4d5e7
Create Date: 2026-11-04 11:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "w1a2b3c4d5e6"
down_revision: str | Sequence[str] | None = "g2a3b4c5d6e7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# frozen copy of app.models.inbox.KINDS at g2a3b4c5d6e7 (penalties; includes goals and homework)
BEFORE_INBOX = (
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
    "goal_full",
    "goal_suggested",
    "jail_card",
)


def upgrade() -> None:
    # Create homework_sites table
    op.create_table(
        "homework_sites",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("kid_id", sa.Integer(), nullable=True),
        sa.Column("domain", sa.String(253), nullable=False),
        sa.Column("kind", sa.String(10), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["kid_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("kid_id", "domain", "kind", name="uq_homework_site"),
        sa.CheckConstraint("kind IN ('allow','block')", name="ck_homework_site_kind"),
        sa.CheckConstraint("kind = 'allow' OR kid_id IS NULL", name="ck_homework_block_family"),
    )

    # Create homework_requests table
    op.create_table(
        "homework_requests",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("kid_id", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("minutes", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("decided_at", sa.DateTime(), nullable=True),
        sa.Column("decided_by_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["kid_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["decided_by_id"], ["users.id"]),
        sa.CheckConstraint(
            "status IN ('pending','approved','denied')",
            name="ck_homework_request_status",
        ),
    )

    # Create homework_activity table
    op.create_table(
        "homework_activity",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("device_id", sa.Integer(), nullable=False),
        sa.Column("session_start", sa.DateTime(), nullable=False),
        sa.Column("domain", sa.String(253), nullable=False),
        sa.Column("via", sa.String(10), nullable=False),
        sa.Column("pulled_by", sa.String(253), nullable=True),
        sa.Column("first_seen", sa.DateTime(), nullable=False),
        sa.Column("last_seen", sa.DateTime(), nullable=False),
        sa.Column("lookups", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("active_minutes", sa.Integer(), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(["device_id"], ["devices.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("device_id", "session_start", "domain", name="uq_homework_activity"),
        sa.CheckConstraint("via IN ('list','follow')", name="ck_homework_activity_via"),
    )

    # Update override action constraint
    with op.batch_alter_table("overrides", schema=None) as batch_op:
        batch_op.drop_constraint("ck_override_action", type_="check")
        batch_op.create_check_constraint(
            "ck_override_action", "action IN ('lock','unlock','homework')"
        )

    # Update notification kind constraint
    notification_kinds = (*BEFORE_INBOX, "homework_request")
    with op.batch_alter_table("notifications", schema=None) as batch_op:
        batch_op.drop_constraint("ck_notification_kind", type_="check")
        batch_op.create_check_constraint(
            "ck_notification_kind",
            "kind IN (" + ",".join(f"'{k}'" for k in notification_kinds) + ")",
        )


def downgrade() -> None:
    # Restore notification kind constraint
    notification_kinds = BEFORE_INBOX
    with op.batch_alter_table("notifications", schema=None) as batch_op:
        batch_op.drop_constraint("ck_notification_kind", type_="check")
        batch_op.create_check_constraint(
            "ck_notification_kind",
            "kind IN (" + ",".join(f"'{k}'" for k in notification_kinds) + ")",
        )

    # Restore override action constraint
    with op.batch_alter_table("overrides", schema=None) as batch_op:
        batch_op.drop_constraint("ck_override_action", type_="check")
        batch_op.create_check_constraint("ck_override_action", "action IN ('lock','unlock')")

    # Drop homework tables
    op.drop_table("homework_activity")
    op.drop_table("homework_requests")
    op.drop_table("homework_sites")
