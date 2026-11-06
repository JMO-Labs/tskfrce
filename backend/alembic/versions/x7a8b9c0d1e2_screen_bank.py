"""screen-time bank

Revision ID: x7a8b9c0d1e2
Revises: w6f7a8b9c0d1
Create Date: 2026-11-06 14:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "x7a8b9c0d1e2"
down_revision: str | Sequence[str] | None = "w6f7a8b9c0d1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("family_settings") as b:
        b.add_column(sa.Column("screen_rollover", sa.Boolean(), nullable=False, server_default="1"))
        b.add_column(sa.Column("screen_bank_cap", sa.Integer(), nullable=True))
    op.create_table(
        "screen_banks",
        sa.Column(
            "kid_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("minutes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("day", sa.Date(), nullable=True),
        sa.CheckConstraint("minutes >= 0", name="ck_screen_bank_minutes"),
    )


def downgrade() -> None:
    op.drop_table("screen_banks")
    with op.batch_alter_table("family_settings") as b:
        b.drop_column("screen_bank_cap")
        b.drop_column("screen_rollover")
