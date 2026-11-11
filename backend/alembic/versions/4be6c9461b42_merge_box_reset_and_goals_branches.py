"""merge_box_reset_and_goals_branches

Revision ID: 4be6c9461b42
Revises: i4c5d6e7f8a9, 31ec443cea32
Create Date: 2026-11-11 13:14:31.593504

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '4be6c9461b42'
down_revision: Union[str, Sequence[str], None] = ('i4c5d6e7f8a9', '31ec443cea32')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
