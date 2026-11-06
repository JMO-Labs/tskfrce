"""families saved at the removed wizard step 8 are finished

Revision ID: w6f7a8b9c0d1
Revises: v5e6f7a8b9c0
Create Date: 2026-11-06 12:00:00.000000
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "w6f7a8b9c0d1"
down_revision: str | Sequence[str] | None = "v5e6f7a8b9c0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("UPDATE family_settings SET setup_step = NULL WHERE setup_step > 7")


def downgrade() -> None:
    pass
