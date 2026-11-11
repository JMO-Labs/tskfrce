"""minigames: plays, progress, family and kid switches

Revision ID: a2m3n4o5p6q7
Revises: i4c5d6e7f8a9
Create Date: 2026-11-10 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a2m3n4o5p6q7"
down_revision: str | Sequence[str] | None = "i4c5d6e7f8a9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

REASONS = "'chore','early_bonus','team_share','redemption','bonus','adjustment','deduction','goal_save','goal_return','penalty'"


def upgrade() -> None:
    with op.batch_alter_table("family_settings") as b:
        b.add_column(sa.Column("games_on", sa.Boolean(), nullable=False, server_default="1"))
        b.add_column(sa.Column("games_earn", sa.String(6), nullable=False, server_default="every"))
        b.add_column(sa.Column("games_cap_pct", sa.Integer(), nullable=False, server_default="10"))
        b.add_column(sa.Column("games_board", sa.Boolean(), nullable=False, server_default="1"))
        b.create_check_constraint(
            "ck_family_games_earn", "games_earn IN ('every','daily','random','custom')"
        )
        b.create_check_constraint("ck_family_games_cap", "games_cap_pct BETWEEN 0 AND 50")
    with op.batch_alter_table("users") as b:
        b.add_column(sa.Column("games_on", sa.Boolean(), nullable=False, server_default="1"))
    with op.batch_alter_table("chores") as b:
        b.add_column(sa.Column("gives_game", sa.Boolean(), nullable=False, server_default="0"))
    with op.batch_alter_table("points") as b:
        b.drop_constraint("ck_points_reason", type_="check")
        b.create_check_constraint("ck_points_reason", f"reason IN ({REASONS},'game')")
    op.create_table(
        "game_plays",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "kid_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("run_id", sa.Integer(), sa.ForeignKey("chore_runs.id", ondelete="SET NULL")),
        sa.Column("earned_day", sa.Date(), nullable=False),
        sa.Column("earned_at", sa.DateTime(), nullable=False),
        sa.Column("status", sa.String(8), nullable=False, server_default="saved"),
        sa.Column("seen", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("token", sa.String(43), unique=True),
        sa.Column("game", sa.String(24)),
        sa.Column("level", sa.Integer()),
        sa.Column("slot", sa.Integer()),
        sa.Column("started_at", sa.DateTime()),
        sa.Column("finished_at", sa.DateTime()),
        sa.Column("score", sa.Integer()),
        sa.Column("stars", sa.Integer()),
        sa.Column("tickets", sa.Integer()),
        sa.Column("points", sa.Integer()),
        sa.CheckConstraint(
            "status IN ('saved','started','done','revoked')", name="ck_game_play_status"
        ),
    )
    op.create_index("ix_game_plays_kid_id", "game_plays", ["kid_id"])
    op.create_table(
        "game_progress",
        sa.Column(
            "kid_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("game", sa.String(32), nullable=False),
        sa.Column("rounds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("best", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("best_stars", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("stars_total", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("clears", sa.Integer(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("kid_id", "game"),
    )


def downgrade() -> None:
    op.drop_table("game_progress")
    op.drop_index("ix_game_plays_kid_id", "game_plays")
    op.drop_table("game_plays")
    op.execute("DELETE FROM points WHERE reason='game'")
    with op.batch_alter_table("points") as b:
        b.drop_constraint("ck_points_reason", type_="check")
        b.create_check_constraint("ck_points_reason", f"reason IN ({REASONS})")
    with op.batch_alter_table("chores") as b:
        b.drop_column("gives_game")
    with op.batch_alter_table("users") as b:
        b.drop_column("games_on")
    with op.batch_alter_table("family_settings") as b:
        b.drop_constraint("ck_family_games_cap", type_="check")
        b.drop_constraint("ck_family_games_earn", type_="check")
        for c in ("games_board", "games_cap_pct", "games_earn", "games_on"):
            b.drop_column(c)
