"""setup presets: style columns, per-kid chores lock, wizard steps 4..8 become 4

Revision ID: d7e8f9a0b1c2
Revises: f1a2b3c4d5e7
Create Date: 2026-11-10 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d7e8f9a0b1c2"
down_revision: str | Sequence[str] | None = "f1a2b3c4d5e7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("family_settings") as b:
        b.add_column(sa.Column("preset_style", sa.String(8), nullable=True))
        b.add_column(sa.Column("preset_base", sa.Text(), nullable=True))
    with op.batch_alter_table("users") as b:
        b.add_column(sa.Column("preset_style", sa.String(8), nullable=True))
        b.add_column(sa.Column("chores_lock", sa.Boolean(), nullable=False, server_default="1"))
    op.execute("UPDATE family_settings SET setup_step = 4 WHERE setup_step BETWEEN 4 AND 8")


def downgrade() -> None:
    with op.batch_alter_table("users") as b:
        b.drop_column("chores_lock")
        b.drop_column("preset_style")
    with op.batch_alter_table("family_settings") as b:
        b.drop_column("preset_base")
        b.drop_column("preset_style")
