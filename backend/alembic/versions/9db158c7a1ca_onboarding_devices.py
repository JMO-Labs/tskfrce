"""onboarding devices

Revision ID: 9db158c7a1ca
Revises: b3n4o5p6q7r8
Create Date: 2026-11-11 12:38:22.306409

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "9db158c7a1ca"
down_revision: str | Sequence[str] | None = "b3n4o5p6q7r8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Add columns to devices table for gateway/box filtering
    op.add_column(
        "devices", sa.Column("is_gateway", sa.Boolean(), nullable=False, server_default="0")
    )
    op.add_column("devices", sa.Column("is_box", sa.Boolean(), nullable=False, server_default="0"))

    # Add column to family_settings for rescan rate-limiting
    op.add_column("family_settings", sa.Column("last_rescan_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column("family_settings", "last_rescan_at")
    op.drop_column("devices", "is_box")
    op.drop_column("devices", "is_gateway")
