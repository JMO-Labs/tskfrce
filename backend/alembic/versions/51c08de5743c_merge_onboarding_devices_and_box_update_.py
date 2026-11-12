"""merge onboarding devices and box_update kind

Revision ID: 51c08de5743c
Revises: 9db158c7a1ca, c3dbbe83435f
Create Date: 2026-11-11 13:55:29.416292

"""

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "51c08de5743c"
down_revision: str | Sequence[str] | None = ("9db158c7a1ca", "c3dbbe83435f")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
