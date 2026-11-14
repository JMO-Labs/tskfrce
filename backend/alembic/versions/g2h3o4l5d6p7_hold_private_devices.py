"""hold new private-MAC devices (opt-in)

Revision ID: g2h3o4l5d6p7
Revises: f1n2g3e4r5b6
Create Date: 2026-11-14 13:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "g2h3o4l5d6p7"
down_revision: str | Sequence[str] | None = "f1n2g3e4r5b6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("devices") as b:
        b.add_column(sa.Column("held", sa.Boolean(), nullable=False, server_default="0"))
    with op.batch_alter_table("family_settings") as b:
        for name in ("hold_private_devices", "hold_private_hint"):
            b.add_column(sa.Column(name, sa.Boolean(), nullable=False, server_default="0"))


def downgrade() -> None:
    with op.batch_alter_table("family_settings") as b:
        b.drop_column("hold_private_hint")
        b.drop_column("hold_private_devices")
    with op.batch_alter_table("devices") as b:
        b.drop_column("held")
