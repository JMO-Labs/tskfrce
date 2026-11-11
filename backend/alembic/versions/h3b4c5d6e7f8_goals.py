"""goals: tables, family goal settings, new points reasons and notification kinds

Revision ID: h3b4c5d6e7f8
Revises: f1a2b3c4d5e7
Create Date: 2026-11-10 09:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "h3b4c5d6e7f8"
down_revision: str | Sequence[str] | None = "f1a2b3c4d5e7"
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
    "trust_up",
    "trust_down",
    "bedtime_done",
    "recap",
)

NEW_INBOX = ("goal_full", "goal_suggested", "jail_card")
# frozen copy of the points.reason values before this revision
OLD_REASONS = (
    "chore",
    "early_bonus",
    "team_share",
    "redemption",
    "bonus",
    "adjustment",
    "deduction",
)
NEW_REASONS = ("goal_save", "goal_return")


def _in(col: str, vals) -> str:
    return f"{col} IN (" + ",".join(f"'{v}'" for v in vals) + ")"


def _kinds(kinds) -> None:
    with op.batch_alter_table("notifications") as b:
        b.drop_constraint("ck_notification_kind", type_="check")
        b.create_check_constraint("ck_notification_kind", _in("kind", kinds))


def _reasons(reasons) -> None:
    with op.batch_alter_table("points") as b:
        b.drop_constraint("ck_points_reason", type_="check")
        b.create_check_constraint("ck_points_reason", _in("reason", reasons))


def _flag(name: str, default: str = "0") -> sa.Column:
    return sa.Column(name, sa.Boolean(), nullable=False, server_default=default)


def _int(name: str, default: str) -> sa.Column:
    return sa.Column(name, sa.Integer(), nullable=False, server_default=default)


SETTINGS = (
    _flag("goals_on", "1"),
    _flag("goal_suggest", "1"),
    _flag("goal_withdraw", "1"),
    _flag("goal_siblings"),
    _flag("goal_auto"),
    _int("goal_auto_pct", "25"),
    _int("goal_max_little", "1"),
    _int("goal_max_kid", "2"),
    _int("goal_max_teen", "3"),
    _flag("goal_screen_on"),
    _int("goal_screen_price", "200"),
    _int("goal_screen_minutes", "60"),
    _flag("goal_jail_on"),
    _int("goal_jail_price", "500"),
)


def _fk(table: str, ondelete: str | None = None) -> sa.ForeignKey:
    return sa.ForeignKey(f"{table}.id", ondelete=ondelete)


def upgrade() -> None:
    op.create_table(
        "goals",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(60), nullable=False),
        sa.Column("emoji", sa.String(16)),
        sa.Column("kind", sa.String(6), nullable=False, server_default="custom"),
        sa.Column("kid_id", sa.Integer(), _fk("users", "CASCADE")),
        sa.Column("target", sa.Integer()),
        sa.Column("minutes", sa.Integer()),
        sa.Column("status", sa.String(9), nullable=False, server_default="active"),
        sa.Column("created_by_id", sa.Integer(), _fk("users"), nullable=False),
        sa.Column("owner_id", sa.Integer(), _fk("users", "SET NULL")),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("reached_at", sa.DateTime()),
        sa.Column("fulfilled_at", sa.DateTime()),
        sa.Column("fulfilled_by_id", sa.Integer(), _fk("users", "SET NULL")),
        sa.CheckConstraint("kind IN ('custom','screen','jail')", name="ck_goal_kind"),
        sa.CheckConstraint(
            "status IN ('suggested','active','full','fulfilled')", name="ck_goal_status"
        ),
    )
    op.create_index("ix_goals_kid_id", "goals", ["kid_id"])
    op.create_table(
        "goal_contributions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("goal_id", sa.Integer(), _fk("goals", "CASCADE"), nullable=False),
        sa.Column("kid_id", sa.Integer(), _fk("users", "SET NULL")),
        sa.Column("by_id", sa.Integer(), _fk("users", "SET NULL")),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(7), nullable=False),
        sa.Column("note", sa.String(120)),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "kind IN ('save','auto','return','chip_in','take')", name="ck_goal_contrib_kind"
        ),
    )
    op.create_index("ix_goal_contributions_goal_id", "goal_contributions", ["goal_id"])
    op.create_table(
        "goal_auto",
        sa.Column("kid_id", sa.Integer(), _fk("users", "CASCADE"), primary_key=True),
        sa.Column("goal_id", sa.Integer(), _fk("goals", "CASCADE"), nullable=False),
    )
    op.create_table(
        "goal_parties",
        sa.Column("goal_id", sa.Integer(), _fk("goals", "CASCADE"), primary_key=True),
        sa.Column("kid_id", sa.Integer(), _fk("users", "CASCADE"), primary_key=True),
        sa.Column("seen_at", sa.DateTime()),
    )
    with op.batch_alter_table("family_settings") as b:
        for c in SETTINGS:
            b.add_column(c.copy())
    _reasons((*OLD_REASONS, *NEW_REASONS))
    _kinds((*OLD_INBOX, *NEW_INBOX))


def downgrade() -> None:
    op.execute("DELETE FROM notifications WHERE kind IN ('goal_full','goal_suggested','jail_card')")
    _kinds(OLD_INBOX)
    op.execute("DELETE FROM points WHERE reason IN ('goal_save','goal_return')")
    _reasons(OLD_REASONS)
    with op.batch_alter_table("family_settings") as b:
        for c in reversed(SETTINGS):
            b.drop_column(c.name)
    op.drop_table("goal_parties")
    op.drop_table("goal_auto")
    op.drop_index("ix_goal_contributions_goal_id", "goal_contributions")
    op.drop_table("goal_contributions")
    op.drop_index("ix_goals_kid_id", "goals")
    op.drop_table("goals")
