"""penalties: table, links on overrides/runs/points, family settings

Revision ID: g2a3b4c5d6e7
Revises: h3b4c5d6e7f8
Create Date: 2026-11-10 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "g2a3b4c5d6e7"
down_revision: str | Sequence[str] | None = "h3b4c5d6e7f8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

REASONS = "'chore','early_bonus','team_share','redemption','bonus','adjustment','deduction','goal_save','goal_return'"


def _fk(b, name: str, ondelete: str) -> None:
    b.create_foreign_key(name, "penalties", ["penalty_id"], ["id"], ondelete=ondelete)


def upgrade() -> None:
    op.create_table(
        "penalties",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "kid_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("group_id", sa.String(32), nullable=True),
        sa.Column("kind", sa.String(6), nullable=False),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column("amount_taken", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("amount_returned", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("back_total", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("makeup_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("earn_back", sa.String(4), nullable=False, server_default="none"),
        sa.Column("device_ids", sa.Text(), nullable=True),
        sa.Column("all_devices", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("label", sa.String(100), nullable=True),
        sa.Column("reason", sa.String(200), nullable=True),
        sa.Column(
            "chore_run_id", sa.Integer(), sa.ForeignKey("chore_runs.id", ondelete="SET NULL")
        ),
        sa.Column(
            "notification_id",
            sa.Integer(),
            sa.ForeignKey("notifications.id", ondelete="SET NULL"),
        ),
        sa.Column("given_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("ends_at", sa.DateTime(), nullable=True),
        sa.Column("ended_at", sa.DateTime(), nullable=True),
        sa.Column("status", sa.String(9), nullable=False, server_default="active"),
        sa.Column("seen_by_kid", sa.Boolean(), nullable=False, server_default="0"),
        sa.CheckConstraint("kind IN ('points','screen','block')", name="ck_penalty_kind"),
        sa.CheckConstraint("earn_back IN ('none','half','all')", name="ck_penalty_earn_back"),
        sa.CheckConstraint(
            "status IN ('active','ended','forgiven','cancelled')", name="ck_penalty_status"
        ),
    )
    op.create_index("ix_penalties_kid_id", "penalties", ["kid_id"])
    with op.batch_alter_table("overrides") as b:
        b.add_column(sa.Column("penalty_id", sa.Integer(), nullable=True))
        _fk(b, "fk_override_penalty", "CASCADE")
        b.drop_constraint("ck_override_source", type_="check")
        b.create_check_constraint("ck_override_source", "source IN ('manual','bonus','penalty')")
    with op.batch_alter_table("chore_runs") as b:
        b.add_column(sa.Column("penalty_id", sa.Integer(), nullable=True))
        _fk(b, "fk_run_penalty", "SET NULL")
        b.create_index("ix_chore_runs_penalty_id", ["penalty_id"])
        b.add_column(sa.Column("makeup_slice", sa.Integer(), nullable=True))
    with op.batch_alter_table("chores") as b:
        b.add_column(sa.Column("makeup", sa.Boolean(), nullable=False, server_default="0"))
    with op.batch_alter_table("points") as b:
        b.add_column(sa.Column("penalty_id", sa.Integer(), nullable=True))
        _fk(b, "fk_points_penalty", "SET NULL")
        b.drop_constraint("ck_points_reason", type_="check")
        b.create_check_constraint("ck_points_reason", f"reason IN ({REASONS},'penalty')")
    with op.batch_alter_table("family_settings") as b:
        b.add_column(
            sa.Column("penalties_enabled", sa.Boolean(), nullable=False, server_default="0")
        )
        b.add_column(sa.Column("penalty_sizes", sa.Text(), nullable=True))
        b.add_column(sa.Column("makeup_chores", sa.Text(), nullable=True))


ASSIGNS = (
    "SELECT id FROM chore_assignments WHERE chore_id IN (SELECT id FROM chores WHERE makeup = 1)"
)
RUN_WHERE = f"penalty_id IS NOT NULL OR assignment_id IN ({ASSIGNS})"
RUNS = f"SELECT id FROM chore_runs WHERE {RUN_WHERE}"
THREADS = f"SELECT id FROM threads WHERE run_id IN ({RUNS})"
MSGS = f"SELECT id FROM thread_messages WHERE thread_id IN ({THREADS})"


def _drop_makeup_chores() -> None:
    """Make-up chores only exist for penalties: remove them and everything hanging off them."""
    for sql in (
        f"DELETE FROM message_reactions WHERE message_id IN ({MSGS})",
        f"DELETE FROM thread_messages WHERE thread_id IN ({THREADS})",
        f"DELETE FROM thread_reads WHERE thread_id IN ({THREADS})",
        f"DELETE FROM chat_photos WHERE thread_id IN ({THREADS})",
        f"DELETE FROM threads WHERE run_id IN ({RUNS})",
        f"DELETE FROM chore_photos WHERE run_id IN ({RUNS})",
        f"UPDATE trust_events SET run_id = NULL WHERE run_id IN ({RUNS})",
        f"UPDATE points SET run_id = NULL WHERE run_id IN ({RUNS})",
        f"DELETE FROM run_step_ticks WHERE run_id IN ({RUNS})",
        f"DELETE FROM run_kids WHERE run_id IN ({RUNS})",
        f"DELETE FROM chore_runs WHERE {RUN_WHERE}",
        f"DELETE FROM assignment_kids WHERE assignment_id IN ({ASSIGNS})",
        f"DELETE FROM chore_seen WHERE assignment_id IN ({ASSIGNS})",
        f"DELETE FROM chore_assignments WHERE id IN ({ASSIGNS})",
        "DELETE FROM chores WHERE makeup = 1",
    ):
        op.execute(sql)


def downgrade() -> None:
    op.execute("DELETE FROM points WHERE reason = 'penalty'")
    _drop_makeup_chores()
    op.execute("DELETE FROM overrides WHERE source = 'penalty'")
    with op.batch_alter_table("family_settings") as b:
        for c in ("makeup_chores", "penalty_sizes", "penalties_enabled"):
            b.drop_column(c)
    with op.batch_alter_table("points") as b:
        b.drop_constraint("ck_points_reason", type_="check")
        b.create_check_constraint("ck_points_reason", f"reason IN ({REASONS})")
        b.drop_constraint("fk_points_penalty", type_="foreignkey")
        b.drop_column("penalty_id")
    with op.batch_alter_table("chores") as b:
        b.drop_column("makeup")
    with op.batch_alter_table("chore_runs") as b:
        b.drop_column("makeup_slice")
        b.drop_index("ix_chore_runs_penalty_id")
        b.drop_constraint("fk_run_penalty", type_="foreignkey")
        b.drop_column("penalty_id")
    with op.batch_alter_table("overrides") as b:
        b.drop_constraint("ck_override_source", type_="check")
        b.create_check_constraint("ck_override_source", "source IN ('manual','bonus')")
        b.drop_constraint("fk_override_penalty", type_="foreignkey")
        b.drop_column("penalty_id")
    op.drop_index("ix_penalties_kid_id", "penalties")
    op.drop_table("penalties")
