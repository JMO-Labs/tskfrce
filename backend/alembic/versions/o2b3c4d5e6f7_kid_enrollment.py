"""kid enrollment tokens, kid device sessions, users.alert_topic, wizard step shift

Wizard gains a step 4 (Kids' phones): stored setup_step >= 4 moves up by one.

Revision ID: o2b3c4d5e6f7
Revises: b0c1d2e3f4a5
Create Date: 2026-11-05 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "o2b3c4d5e6f7"
down_revision: str | Sequence[str] | None = "b0c1d2e3f4a5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "kid_enroll_tokens",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "kid_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column(
            "created_by_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("used_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index("ix_kid_enroll_tokens_kid_id", "kid_enroll_tokens", ["kid_id"])
    op.create_table(
        "kid_devices",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "kid_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("secret_hash", sa.String(64), nullable=False),
        sa.Column("label", sa.String(40), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("secret_hash"),
    )
    op.create_index("ix_kid_devices_kid_id", "kid_devices", ["kid_id"])
    with op.batch_alter_table("users") as b:
        b.add_column(sa.Column("alert_topic", sa.String(64), nullable=True))
        b.create_unique_constraint("uq_users_alert_topic", ["alert_topic"])
    op.execute("UPDATE family_settings SET setup_step = setup_step + 1 WHERE setup_step >= 4")


def downgrade() -> None:
    op.execute("UPDATE family_settings SET setup_step = setup_step - 1 WHERE setup_step >= 5")
    with op.batch_alter_table("users") as b:
        b.drop_constraint("uq_users_alert_topic", type_="unique")
        b.drop_column("alert_topic")
    op.drop_index("ix_kid_devices_kid_id", table_name="kid_devices")
    op.drop_table("kid_devices")
    op.drop_index("ix_kid_enroll_tokens_kid_id", table_name="kid_enroll_tokens")
    op.drop_table("kid_enroll_tokens")
