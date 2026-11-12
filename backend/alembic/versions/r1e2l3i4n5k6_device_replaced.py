"""devices.replaced: superseded by a relinked private MAC

Revision ID: r1e2l3i4n5k6
Revises: 0b953fcb092f
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "r1e2l3i4n5k6"
down_revision: str | Sequence[str] | None = "0b953fcb092f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("devices") as b:
        b.add_column(sa.Column("replaced", sa.Boolean(), nullable=False, server_default="0"))


def downgrade() -> None:
    with op.batch_alter_table("devices") as b:
        b.drop_column("replaced")
