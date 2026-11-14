"""device_events.detail 120 -> 1000 (bypass evidence sample)

Revision ID: 8085632db8db
Revises: 7b2e4c1a9f30
Create Date: 2026-11-14 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "8085632db8db"
down_revision: str | Sequence[str] | None = "7b2e4c1a9f30"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("device_events") as b:
        b.alter_column("detail", existing_type=sa.String(120), type_=sa.String(1000))


def downgrade() -> None:
    raise NotImplementedError("forward-only")
