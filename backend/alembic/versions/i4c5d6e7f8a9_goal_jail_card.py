"""goals: played_at and penalty_id for the Get out of jail free card

Revision ID: i4c5d6e7f8a9
Revises: d7e8f9a0b1c2
Create Date: 2026-11-10 14:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "i4c5d6e7f8a9"
down_revision: str | Sequence[str] | None = "d7e8f9a0b1c2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("goals") as b:
        b.add_column(sa.Column("played_at", sa.DateTime(), nullable=True))
        b.add_column(sa.Column("penalty_id", sa.Integer(), nullable=True))
        b.create_foreign_key(
            "fk_goals_penalty_id", "penalties", ["penalty_id"], ["id"], ondelete="SET NULL"
        )


def downgrade() -> None:
    with op.batch_alter_table("goals") as b:
        b.drop_constraint("fk_goals_penalty_id", type_="foreignkey")
        b.drop_column("penalty_id")
        b.drop_column("played_at")
