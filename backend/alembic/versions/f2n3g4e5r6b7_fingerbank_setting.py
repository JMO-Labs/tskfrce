"""Fingerbank opt-in setting on family_settings

Revision ID: f2n3g4e5r6b7
Revises: n3t4w5k6i7d8
Create Date: 2026-11-14 15:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f2n3g4e5r6b7"
down_revision: str | Sequence[str] | None = "n3t4w5k6i7d8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_BOOLS = ("fingerbank_enabled", "fingerbank_cloud", "fingerbank_hint_seen")


def upgrade() -> None:
    with op.batch_alter_table("family_settings") as b:
        for c in _BOOLS:
            b.add_column(sa.Column(c, sa.Boolean(), nullable=False, server_default="0"))
        b.add_column(sa.Column("fingerbank_api_key", sa.String(100), nullable=True))
        b.add_column(sa.Column("fingerbank_synced_at", sa.DateTime(), nullable=True))
        b.add_column(sa.Column("fingerbank_attempted_at", sa.DateTime(), nullable=True))
        b.add_column(sa.Column("fingerbank_last_error", sa.String(30), nullable=True))
        b.add_column(sa.Column("fingerbank_last_error_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("family_settings") as b:
        b.drop_column("fingerbank_last_error_at")
        b.drop_column("fingerbank_last_error")
        b.drop_column("fingerbank_attempted_at")
        b.drop_column("fingerbank_synced_at")
        b.drop_column("fingerbank_api_key")
        for c in reversed(_BOOLS):
            b.drop_column(c)
