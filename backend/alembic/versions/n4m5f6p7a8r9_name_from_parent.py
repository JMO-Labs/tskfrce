"""devices.name_from_parent

Revision ID: n4m5f6p7a8r9
Revises: n3t4w5k6i7d8
Create Date: 2026-11-14 13:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "n4m5f6p7a8r9"
down_revision: str | Sequence[str] | None = "n3t4w5k6i7d8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("devices") as b:
        b.add_column(
            sa.Column("name_from_parent", sa.Boolean(), nullable=False, server_default="0")
        )
    # Names that differ from what auto-naming gives were edited by a parent: keep them.
    op.execute(
        "UPDATE devices SET name_from_parent = 1 WHERE name != 'Unknown device' "
        "AND name != COALESCE(hostname, '') AND name != COALESCE(mdns_name, '') "
        "AND name != COALESCE(vendor || ' device', '') AND name != COALESCE(vendor, '')"
    )


def downgrade() -> None:
    with op.batch_alter_table("devices") as b:
        b.drop_column("name_from_parent")
