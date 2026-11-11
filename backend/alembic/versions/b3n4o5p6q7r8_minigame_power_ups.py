"""minigame power-ups

Revision ID: b3n4o5p6q7r8
Revises: a2m3n4o5p6q7
Create Date: 2026-11-10 18:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b3n4o5p6q7r8"
down_revision: str | Sequence[str] | None = "a2m3n4o5p6q7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "game_power_ups",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "kid_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("game", sa.String(32), nullable=False),
        sa.Column("key", sa.String(16), nullable=False),
        sa.Column("won_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_game_power_ups_kid_id", "game_power_ups", ["kid_id"])


def downgrade() -> None:
    op.drop_index("ix_game_power_ups_kid_id", "game_power_ups")
    op.drop_table("game_power_ups")
