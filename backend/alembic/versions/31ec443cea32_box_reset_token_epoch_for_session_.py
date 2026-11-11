"""box reset: token_epoch for session invalidation

Revision ID: 31ec443cea32
Revises: z9c0d1e2f3a4
Create Date: 2026-11-11 10:47:47.376791

Tracks JWT/session token epoch per family. On reset or forgot-PIN,
token_epoch is bumped, invalidating all existing tokens.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = '31ec443cea32'
down_revision: str | Sequence[str] | None = 'z9c0d1e2f3a4'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add token_epoch column to family_settings."""
    op.add_column('family_settings', sa.Column('token_epoch', sa.Integer(), nullable=False, server_default='0'))


def downgrade() -> None:
    """Remove token_epoch column from family_settings."""
    op.drop_column('family_settings', 'token_epoch')
