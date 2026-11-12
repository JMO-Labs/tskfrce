"""users: optional birth_month/birth_year and age_group_set_at

Revision ID: b1r2t3h4d5a6
Revises: s1u2g3g4e5s6
Create Date: 2026-11-11 19:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b1r2t3h4d5a6"
down_revision: str | Sequence[str] | None = "s1u2g3g4e5s6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("users") as b:
        b.add_column(sa.Column("birth_month", sa.Integer(), nullable=True))
        b.add_column(sa.Column("birth_year", sa.Integer(), nullable=True))
        b.add_column(sa.Column("age_group_set_at", sa.DateTime(), nullable=True))
        b.create_check_constraint("ck_user_birth_month", "birth_month BETWEEN 1 AND 12")
        b.create_check_constraint("ck_user_birth_year", "birth_year BETWEEN 1990 AND 2100")
        b.create_check_constraint(
            "ck_user_birth_both_or_neither", "(birth_month IS NULL) = (birth_year IS NULL)"
        )


def downgrade() -> None:
    with op.batch_alter_table("users") as b:
        b.drop_constraint("ck_user_birth_both_or_neither", type_="check")
        b.drop_constraint("ck_user_birth_year", type_="check")
        b.drop_constraint("ck_user_birth_month", type_="check")
        b.drop_column("age_group_set_at")
        b.drop_column("birth_year")
        b.drop_column("birth_month")
