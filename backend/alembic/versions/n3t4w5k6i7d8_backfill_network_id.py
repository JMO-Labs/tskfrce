"""backfill devices.network_id from ip/CIDR

Revision ID: n3t4w5k6i7d8
Revises: f1n2g3e4r5b6
Create Date: 2026-11-14 13:00:00.000000
"""

import ipaddress
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "n3t4w5k6i7d8"
down_revision: str | Sequence[str] | None = "f1n2g3e4r5b6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    c = op.get_bind()
    nets = []
    for nid, sub in c.exec_driver_sql("SELECT id, subnet FROM networks ORDER BY id"):
        try:
            if sub:
                nets.append((nid, ipaddress.ip_network(sub, strict=False)))
        except ValueError:
            pass
    rows = c.exec_driver_sql(
        "SELECT id, ip FROM devices WHERE network_id IS NULL AND ip IS NOT NULL"
    ).fetchall()
    for did, ip in rows:
        try:
            addr = ipaddress.ip_address(ip)
        except ValueError:
            continue
        nid = next((n for n, net in nets if addr in net), None)
        if nid is not None:
            c.execute(
                sa.text("UPDATE devices SET network_id = :n WHERE id = :d"), {"n": nid, "d": did}
            )


def downgrade() -> None:
    """Data-only backfill: nothing to undo."""
