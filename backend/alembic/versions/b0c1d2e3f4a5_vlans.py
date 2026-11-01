"""vlans table, devices.vlan_id, family_settings.listen_only

Revision ID: b0c1d2e3f4a5
Revises: a8b9c0d1e2f3
Create Date: 2026-10-24 15:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b0c1d2e3f4a5"
down_revision: str | Sequence[str] | None = "a8b9c0d1e2f3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "vlans",
        sa.Column("vid", sa.Integer(), autoincrement=False, primary_key=True),
        sa.Column("name", sa.String(50), nullable=True),
        sa.Column("subnet", sa.String(43), nullable=True),
        sa.Column("device_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("first_seen", sa.DateTime(), nullable=False),
        sa.Column("last_seen", sa.DateTime(), nullable=False),
        sa.Column("covered", sa.Boolean(), nullable=False, server_default="0"),
        sa.CheckConstraint("vid BETWEEN 1 AND 4094", name="ck_vlan_vid"),
    )
    with op.batch_alter_table("devices") as b:
        b.add_column(sa.Column("vlan_id", sa.Integer(), nullable=True))
    with op.batch_alter_table("family_settings") as b:
        b.add_column(sa.Column("listen_only", sa.Boolean(), nullable=False, server_default="0"))


def downgrade() -> None:
    with op.batch_alter_table("family_settings") as b:
        b.drop_column("listen_only")
    with op.batch_alter_table("devices") as b:
        b.drop_column("vlan_id")
    op.drop_table("vlans")
