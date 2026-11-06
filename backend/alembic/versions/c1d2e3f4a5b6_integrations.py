"""integrations: installs, grants, audit log, event outbox, reward link

Revision ID: c1d2e3f4a5b6
Revises: b0c1d2e3f4a5
Create Date: 2026-11-04 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c1d2e3f4a5b6"
down_revision: str | Sequence[str] | None = "b0c1d2e3f4a5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

INSTALL = "integration_installs.id"


def upgrade() -> None:
    op.create_table(
        "integration_installs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("public_id", sa.String(32), nullable=False, unique=True),
        sa.Column("source", sa.String(8), nullable=False),
        sa.Column("integration_id", sa.String(40), nullable=True),
        sa.Column("name", sa.String(40), nullable=False),
        sa.Column("icon", sa.String(40), nullable=False),
        sa.Column("manifest", sa.Text(), nullable=True),
        sa.Column("settings", sa.Text(), nullable=True),
        sa.Column("permissions", sa.Text(), nullable=False),
        sa.Column("secret", sa.Text(), nullable=True),
        sa.Column("key_hash", sa.String(64), nullable=True, unique=True),
        sa.Column("key_prefix", sa.String(16), nullable=True),
        sa.Column("trusted", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(10), nullable=False),
        sa.Column("paused_reason", sa.String(200), nullable=True),
        sa.Column("failures", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("next_poll_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("removed_at", sa.DateTime(), nullable=True),
        sa.CheckConstraint("source IN ('catalog','local')", name="ck_integration_source"),
        sa.CheckConstraint(
            "status IN ('active','paused','revoked','removed')", name="ck_integration_status"
        ),
    )
    op.create_table(
        "integration_kids",
        sa.Column(
            "install_id", sa.Integer(), sa.ForeignKey(INSTALL, ondelete="CASCADE"), primary_key=True
        ),
        sa.Column(
            "kid_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column("kid_widgets", sa.Boolean(), nullable=False, server_default="0"),
    )
    op.create_table(
        "integration_chores",
        sa.Column(
            "install_id", sa.Integer(), sa.ForeignKey(INSTALL, ondelete="CASCADE"), primary_key=True
        ),
        sa.Column(
            "chore_id",
            sa.Integer(),
            sa.ForeignKey("chores.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )
    op.create_table(
        "integration_actions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "install_id", sa.Integer(), sa.ForeignKey(INSTALL, ondelete="CASCADE"), nullable=False
        ),
        sa.Column("kind", sa.String(24), nullable=False),
        sa.Column("idempotency_key", sa.String(80), nullable=False),
        sa.Column("result", sa.String(8), nullable=False),
        sa.Column("reason", sa.String(200), nullable=True),
        sa.Column("kid_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("chore_id", sa.Integer(), sa.ForeignKey("chores.id", ondelete="SET NULL")),
        sa.Column("run_id", sa.Integer(), sa.ForeignKey("chore_runs.id", ondelete="SET NULL")),
        sa.Column(
            "redemption_id", sa.Integer(), sa.ForeignKey("redemptions.id", ondelete="SET NULL")
        ),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "result IN ('applied','pending','rejected')", name="ck_integration_action_result"
        ),
        sa.UniqueConstraint("install_id", "idempotency_key", name="uq_integration_action_key"),
    )
    op.create_index(
        "ix_integration_actions_install_created",
        "integration_actions",
        ["install_id", "created_at"],
    )
    op.create_table(
        "integration_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "install_id", sa.Integer(), sa.ForeignKey(INSTALL, ondelete="CASCADE"), nullable=False
        ),
        sa.Column("kind", sa.String(24), nullable=False),
        sa.Column("payload", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
    )
    with op.batch_alter_table("rewards") as b:
        b.add_column(sa.Column("integration_install_id", sa.Integer(), nullable=True))
        b.add_column(sa.Column("integration_ref", sa.String(64), nullable=True))
        b.create_foreign_key(
            "fk_reward_integration_install",
            "integration_installs",
            ["integration_install_id"],
            ["id"],
            ondelete="SET NULL",
        )
        b.create_unique_constraint(
            "uq_reward_integration_ref", ["integration_install_id", "integration_ref"]
        )


def downgrade() -> None:
    with op.batch_alter_table("rewards") as b:
        b.drop_constraint("uq_reward_integration_ref", type_="unique")
        b.drop_constraint("fk_reward_integration_install", type_="foreignkey")
        b.drop_column("integration_ref")
        b.drop_column("integration_install_id")
    op.drop_table("integration_events")
    op.drop_index("ix_integration_actions_install_created", "integration_actions")
    op.drop_table("integration_actions")
    op.drop_table("integration_chores")
    op.drop_table("integration_kids")
    op.drop_table("integration_installs")
