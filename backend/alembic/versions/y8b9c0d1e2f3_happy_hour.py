"""happy hour

Revision ID: y8b9c0d1e2f3
Revises: x7a8b9c0d1e2
Create Date: 2026-11-06 18:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "y8b9c0d1e2f3"
down_revision: str | Sequence[str] | None = "x7a8b9c0d1e2"
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
)


def _kinds(kinds) -> None:
    with op.batch_alter_table("notifications") as b:
        b.drop_constraint("ck_notification_kind", type_="check")
        b.create_check_constraint(
            "ck_notification_kind", "kind IN (" + ",".join(f"'{k}'" for k in kinds) + ")"
        )


def upgrade() -> None:
    op.create_table(
        "happy_hours",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("starts_at", sa.DateTime(), nullable=False, index=True),
        sa.Column("ends_at", sa.DateTime(), nullable=False, index=True),
        sa.Column("mult_x10", sa.Integer(), nullable=False),
        sa.Column("source", sa.String(10), nullable=False),
        sa.Column("kid_ids", sa.JSON(), nullable=True),
        sa.Column(
            "created_by",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.CheckConstraint("mult_x10 IN (15, 20, 30)", name="ck_hh_mult"),
        sa.CheckConstraint("source IN ('parent','schedule','auto')", name="ck_hh_source"),
    )
    with op.batch_alter_table("chore_runs") as b:
        b.add_column(sa.Column("hh_mult_x10", sa.Integer(), nullable=True))
    with op.batch_alter_table("family_settings") as b:
        b.add_column(
            sa.Column("hh_default_mult_x10", sa.Integer(), nullable=False, server_default="20")
        )
        b.add_column(
            sa.Column("hh_default_minutes", sa.Integer(), nullable=False, server_default="60")
        )
        b.add_column(
            sa.Column("hh_weekly_surprise", sa.Boolean(), nullable=False, server_default="0")
        )
        b.add_column(sa.Column("hh_auto_boost", sa.Boolean(), nullable=False, server_default="1"))
        b.add_column(sa.Column("hh_auto_date", sa.Date(), nullable=True))
        b.add_column(sa.Column("hh_surprise_date", sa.Date(), nullable=True))
    _kinds((*OLD_INBOX, "happy_hour"))


def downgrade() -> None:
    op.execute("DELETE FROM notifications WHERE kind = 'happy_hour'")
    _kinds(OLD_INBOX)
    with op.batch_alter_table("family_settings") as b:
        for c in (
            "hh_surprise_date",
            "hh_auto_date",
            "hh_auto_boost",
            "hh_weekly_surprise",
            "hh_default_minutes",
            "hh_default_mult_x10",
        ):
            b.drop_column(c)
    with op.batch_alter_table("chore_runs") as b:
        b.drop_column("hh_mult_x10")
    op.drop_table("happy_hours")
