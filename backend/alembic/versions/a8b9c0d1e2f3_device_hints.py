"""device hint signals, hint link, rejections, device_hint notification kind

Revision ID: a8b9c0d1e2f3
Revises: t3c4d5e6f7a8
Create Date: 2026-10-24 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a8b9c0d1e2f3"
down_revision: str | Sequence[str] | None = "t3c4d5e6f7a8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Kinds as of t3c4d5e6f7a8 (main head before this branch); this migration adds "device_hint".
OLD_KINDS = (
    "chore_submitted",
    "redemption_request",
    "redemption_decided",
    "device_resisting",
    "new_device",
    "badge_earned",
    "level_up",
    "chat_message",
    "chore_note",
    "chore_new",
    "due_soon",
    "missed_deadline",
    "chore_approved",
    "chore_sent_back",
    "points_taken",
    "lock_warning",
    "device_bypass",
    "box_offline",
)
KINDS = (*OLD_KINDS, "device_hint")


def _check(kinds) -> str:
    return "kind IN (" + ",".join(f"'{k}'" for k in kinds) + ")"


def upgrade() -> None:
    with op.batch_alter_table("devices") as b:
        b.add_column(sa.Column("mdns_name", sa.String(255), nullable=True))
        b.add_column(sa.Column("model", sa.String(255), nullable=True))
        b.add_column(sa.Column("dhcp_fp", sa.String(255), nullable=True))
        b.add_column(sa.Column("hint_of_id", sa.Integer(), nullable=True))
        b.add_column(sa.Column("hint_reason", sa.String(10), nullable=True))
        b.create_foreign_key(
            "fk_devices_hint_of_id", "devices", ["hint_of_id"], ["id"], ondelete="SET NULL"
        )
    op.create_table(
        "device_hint_rejections",
        sa.Column(
            "device_id",
            sa.Integer(),
            sa.ForeignKey("devices.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "candidate_id",
            sa.Integer(),
            sa.ForeignKey("devices.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )
    with op.batch_alter_table("notifications") as b:
        b.drop_constraint("ck_notification_kind", type_="check")
        b.create_check_constraint("ck_notification_kind", _check(KINDS))


def downgrade() -> None:
    op.execute("DELETE FROM notifications WHERE kind = 'device_hint'")
    with op.batch_alter_table("notifications") as b:
        b.drop_constraint("ck_notification_kind", type_="check")
        b.create_check_constraint("ck_notification_kind", _check(OLD_KINDS))
    op.drop_table("device_hint_rejections")
    with op.batch_alter_table("devices") as b:
        b.drop_constraint("fk_devices_hint_of_id", type_="foreignkey")
        for col in ("hint_reason", "hint_of_id", "dhcp_fp", "model", "mdns_name"):
            b.drop_column(col)
