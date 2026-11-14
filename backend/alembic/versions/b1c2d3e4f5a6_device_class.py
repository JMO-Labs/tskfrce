"""device class (Fingerbank)

Revision ID: b1c2d3e4f5a6
Revises: 8085632db8db
Create Date: 2026-11-14 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b1c2d3e4f5a6"
down_revision: str | Sequence[str] | None = "8085632db8db"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("devices") as b:
        b.add_column(sa.Column("device_class", sa.String(255), nullable=True))
        b.add_column(sa.Column("device_class_score", sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("devices") as b:
        b.drop_column("device_class_score")
        b.drop_column("device_class")
