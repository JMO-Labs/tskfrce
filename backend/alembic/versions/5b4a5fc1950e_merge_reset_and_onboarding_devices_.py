"""Merge reset and onboarding devices branches

Revision ID: 5b4a5fc1950e
Revises: 31ec443cea32, i4c5d6e7f8a9
Create Date: 2026-11-11 13:34:01.070516

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '5b4a5fc1950e'
down_revision: Union[str, Sequence[str], None] = ('31ec443cea32', 'i4c5d6e7f8a9')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
