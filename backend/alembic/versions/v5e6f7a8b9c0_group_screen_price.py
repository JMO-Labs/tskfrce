"""per-group screen price

Revision ID: v5e6f7a8b9c0
Revises: u4d5e6f7a8b9
Create Date: 2026-11-06 10:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "v5e6f7a8b9c0"
down_revision: str | Sequence[str] | None = "u4d5e6f7a8b9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("device_groups") as b:
        b.add_column(sa.Column("screen_price", sa.Integer(), nullable=True))
    with op.batch_alter_table("redemptions") as b:
        b.add_column(sa.Column("device_group_id", sa.Integer(), nullable=True))
        b.create_foreign_key(
            "fk_redemptions_device_group_id",
            "device_groups",
            ["device_group_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    with op.batch_alter_table("redemptions") as b:
        b.drop_constraint("fk_redemptions_device_group_id", type_="foreignkey")
        b.drop_column("device_group_id")
    with op.batch_alter_table("device_groups") as b:
        b.drop_column("screen_price")
