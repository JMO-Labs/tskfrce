"""box reset: token_epoch for session invalidation on reset/PIN recovery

Revision ID: c0d1e2f3a4b5
Revises: z9c0d1e2f3a4, b3n4o5p6q7r8
Create Date: 2026-11-11 16:00:00.000000

Tracks JWT/session token epoch per family. On reset or forgot-PIN,
token_epoch is bumped, invalidating all existing tokens.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c0d1e2f3a4b5"
down_revision: str | Sequence[str] | None = ("z9c0d1e2f3a4", "b3n4o5p6q7r8")  # merge: boost + minigame_power_ups
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("family_settings", sa.Column("token_epoch", sa.Integer(), nullable=False, server_default="0"))


def downgrade() -> None:
    op.drop_column("family_settings", "token_epoch")
