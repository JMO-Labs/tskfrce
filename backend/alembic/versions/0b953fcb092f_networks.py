"""networks table and devices.network_id

Revision ID: 0b953fcb092f
Revises: d7e8f9a0b1c2
Create Date: 2026-11-11 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0b953fcb092f"
down_revision: str | Sequence[str] | None = "b3n4o5p6q7r8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "networks",
        sa.Column("id", sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column("iface", sa.String(15), nullable=False),
        sa.Column("subnet", sa.String(43), nullable=True),
        sa.Column("auto_label", sa.String(50), nullable=False),
        sa.Column("custom_label", sa.String(100), nullable=True),
        sa.Column("enforce", sa.Boolean(), nullable=False, server_default="1"),
        sa.Column("first_seen", sa.DateTime(), nullable=False),
        sa.Column("last_seen", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("iface", "subnet", name="uq_network_iface_subnet"),
    )
    with op.batch_alter_table("devices") as b:
        b.add_column(
            sa.Column(
                "network_id",
                sa.Integer(),
                sa.ForeignKey("networks.id", ondelete="SET NULL"),
                nullable=True,
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("devices") as b:
        b.drop_column("network_id")
    op.drop_table("networks")
