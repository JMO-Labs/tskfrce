"""suggestion_state: dismissed suggestions and muted rules

Revision ID: s1u2g3g4e5s6
Revises: r1e2l3i4n5k6
Create Date: 2026-11-11 18:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "s1u2g3g4e5s6"
down_revision: str | Sequence[str] | None = "r1e2l3i4n5k6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "suggestion_state",
        sa.Column("id", sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column("family_id", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("key", sa.String(80), nullable=False),
        sa.Column("fingerprint", sa.String(80), nullable=True),
        sa.Column("muted", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("family_id", "key", name="uq_suggestion_state_key"),
    )
    op.create_index("ix_suggestion_state_family_id", "suggestion_state", ["family_id"])


def downgrade() -> None:
    op.drop_index("ix_suggestion_state_family_id", table_name="suggestion_state")
    op.drop_table("suggestion_state")
