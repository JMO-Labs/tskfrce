"""chore_runs.status gains 'missed' (past todo runs the reset used to cancel)

Revision ID: b1c2d3e4f5a6
Revises: a0b1c2d3e4f5
Create Date: 2026-11-07 09:00:00.000000
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b1c2d3e4f5a6"
down_revision: str | Sequence[str] | None = "a0b1c2d3e4f5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

RUN_STATUS = "status IN ('todo','submitted','done','cancelled','skipped'{})"


def _swap(check: str) -> None:
    # batch rebuild: the partial unique indexes are reflected and recreated with the table
    with op.batch_alter_table("chore_runs") as b:
        b.drop_constraint("ck_run_status", type_="check")
        b.create_check_constraint("ck_run_status", check)


def upgrade() -> None:
    _swap(RUN_STATUS.format(",'missed'"))


def downgrade() -> None:
    op.execute("UPDATE chore_runs SET status = 'cancelled' WHERE status = 'missed'")
    _swap(RUN_STATUS.format(""))
