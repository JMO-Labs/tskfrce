"""device status 'ignored'

Revision ID: e7f8a9b0c1d2
Revises: 51c08de5743c
Create Date: 2026-11-11 12:00:00.000000
"""

from collections.abc import Sequence

from alembic import op

revision: str = "e7f8a9b0c1d2"
down_revision: str | Sequence[str] | None = "51c08de5743c"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

OLD = "status IN ('unassigned','assigned','guest')"
NEW = "status IN ('unassigned','assigned','guest','ignored')"


def _swap(check: str) -> None:
    with op.batch_alter_table("devices") as b:
        b.drop_constraint("ck_device_status", type_="check")
        b.create_check_constraint("ck_device_status", check)


def upgrade() -> None:
    _swap(NEW)


def downgrade() -> None:
    op.execute("UPDATE devices SET status = 'unassigned' WHERE status = 'ignored'")
    _swap(OLD)
