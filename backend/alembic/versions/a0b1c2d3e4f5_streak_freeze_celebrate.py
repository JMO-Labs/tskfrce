"""streak freeze switch and per-kid celebration level

Revision ID: a0b1c2d3e4f5
Revises: z9c0d1e2f3a4
Create Date: 2026-11-06 22:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a0b1c2d3e4f5"
down_revision: str | Sequence[str] | None = "z9c0d1e2f3a4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("family_settings") as b:
        b.add_column(sa.Column("streak_freeze", sa.Boolean(), nullable=False, server_default="1"))
    with op.batch_alter_table("users") as b:
        b.add_column(sa.Column("celebrate", sa.String(5), nullable=True))
        b.create_check_constraint("ck_user_celebrate", "celebrate IN ('full','small','off')")


def downgrade() -> None:
    with op.batch_alter_table("users") as b:
        b.drop_constraint("ck_user_celebrate", type_="check")
        b.drop_column("celebrate")
    with op.batch_alter_table("family_settings") as b:
        b.drop_column("streak_freeze")
