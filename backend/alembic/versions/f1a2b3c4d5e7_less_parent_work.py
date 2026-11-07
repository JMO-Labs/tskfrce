"""trust mode, bedtime auto-approve, weekly recap

Revision ID: f1a2b3c4d5e7
Revises: b1c2d3e4f5a6
Create Date: 2026-11-06 23:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f1a2b3c4d5e7"
down_revision: str | Sequence[str] | None = "b1c2d3e4f5a6"
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
    "boost",
)


def _kinds(kinds) -> None:
    with op.batch_alter_table("notifications") as b:
        b.drop_constraint("ck_notification_kind", type_="check")
        b.create_check_constraint(
            "ck_notification_kind", "kind IN (" + ",".join(f"'{k}'" for k in kinds) + ")"
        )


def _flag(name: str, default: str = "0") -> sa.Column:
    return sa.Column(name, sa.Boolean(), nullable=False, server_default=default)


def upgrade() -> None:
    with op.batch_alter_table("users") as b:
        b.add_column(_flag("trust_mode"))
        b.add_column(sa.Column("trust_level", sa.Integer(), nullable=False, server_default="0"))
        b.add_column(sa.Column("trust_clean", sa.Integer(), nullable=False, server_default="0"))
    with op.batch_alter_table("chores") as b:
        b.add_column(_flag("always_check"))
    with op.batch_alter_table("chore_runs") as b:
        b.add_column(_flag("spot_check"))
        b.add_column(sa.Column("approved_via", sa.String(11), nullable=True))
        b.create_check_constraint(
            "ck_run_via", "approved_via IN ('parent','trust','bedtime','integration')"
        )
    with op.batch_alter_table("family_settings") as b:
        b.add_column(_flag("bedtime_auto"))
        b.add_column(
            sa.Column("bedtime_auto_at", sa.String(5), nullable=False, server_default="21:00")
        )
        b.add_column(sa.Column("bedtime_date", sa.Date(), nullable=True))
        b.add_column(_flag("recap_weekly", "1"))
        b.add_column(sa.Column("recap_date", sa.Date(), nullable=True))
        b.add_column(
            sa.Column("waiting_reset_days", sa.Integer(), nullable=False, server_default="0")
        )
    op.create_table(
        "trust_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "kid_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("at", sa.DateTime(), nullable=False),
        sa.Column("kind", sa.String(5), nullable=False),
        sa.Column("run_id", sa.Integer(), sa.ForeignKey("chore_runs.id", ondelete="SET NULL")),
        sa.Column("by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.CheckConstraint("kind IN ('up','down','catch')", name="ck_trust_kind"),
    )
    op.create_index("ix_trust_events_kid_id", "trust_events", ["kid_id"])
    # existing places get the new event too
    op.execute(
        "UPDATE notify_places SET events = CASE WHEN events = '' THEN 'recap' "
        "ELSE events || ',recap' END WHERE ',' || events || ',' NOT LIKE '%,recap,%'"
    )
    _kinds((*OLD_INBOX, "trust_up", "trust_down", "bedtime_done", "recap"))


def downgrade() -> None:
    op.execute(
        "DELETE FROM notifications WHERE kind IN ('trust_up','trust_down','bedtime_done','recap')"
    )
    op.execute(
        "UPDATE notify_places SET events = trim(replace(',' || events || ',', ',recap,', ','), ',')"
    )
    _kinds(OLD_INBOX)
    op.drop_index("ix_trust_events_kid_id", "trust_events")
    op.drop_table("trust_events")
    with op.batch_alter_table("family_settings") as b:
        for c in (
            "waiting_reset_days",
            "recap_date",
            "recap_weekly",
            "bedtime_date",
            "bedtime_auto_at",
            "bedtime_auto",
        ):
            b.drop_column(c)
    with op.batch_alter_table("chore_runs") as b:
        b.drop_constraint("ck_run_via", type_="check")
        b.drop_column("approved_via")
        b.drop_column("spot_check")
    with op.batch_alter_table("chores") as b:
        b.drop_column("always_check")
    with op.batch_alter_table("users") as b:
        for c in ("trust_clean", "trust_level", "trust_mode"):
            b.drop_column(c)
