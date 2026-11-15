"""provisional hold for possible relinks

Revision ID: p7v8s9n0l1h2
Revises: f2n3g4e5r6b7
Create Date: 2026-11-15 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "p7v8s9n0l1h2"
down_revision: str | Sequence[str] | None = "f2n3g4e5r6b7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("devices") as b:
        b.add_column(
            sa.Column("held_provisional", sa.Boolean(), nullable=False, server_default="0")
        )


def downgrade() -> None:
    with op.batch_alter_table("devices") as b:
        b.drop_column("held_provisional")
