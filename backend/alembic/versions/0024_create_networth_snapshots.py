"""Create networth_snapshots table

Revision ID: 0024
Revises: 0023
Create Date: 2026-06-22
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0024"
down_revision = "0023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table("networth_snapshots"):
        return
    op.create_table(
        "networth_snapshots",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("net_worth_usd", sa.Numeric(18, 4), nullable=False),
        sa.Column("assets_usd", sa.Numeric(18, 4), nullable=False),
        sa.Column("liabilities_usd", sa.Numeric(18, 4), nullable=False),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_networth_snapshots_user_id", "networth_snapshots", ["user_id"])
    op.create_index("ix_networth_snapshots_recorded_at", "networth_snapshots", ["recorded_at"])


def downgrade() -> None:
    op.drop_index("ix_networth_snapshots_recorded_at", table_name="networth_snapshots")
    op.drop_index("ix_networth_snapshots_user_id", table_name="networth_snapshots")
    op.drop_table("networth_snapshots")
