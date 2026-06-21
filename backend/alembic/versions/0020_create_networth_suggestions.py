"""create networth_suggestions table

Revision ID: 0020
Revises: 0019
Create Date: 2026-06-21
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "networth_suggestions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("suggestion_type", sa.String(50), nullable=False),
        sa.Column(
            "asset_id",
            UUID(as_uuid=True),
            sa.ForeignKey("assets.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("suggested_change", sa.Numeric(18, 2), nullable=False),
        sa.Column("currency", sa.String(10), nullable=False, server_default="TRY"),
        sa.Column("reason", sa.Text, nullable=False),
        sa.Column("source_batch_id", sa.String(36), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_networth_suggestions_user_id", "networth_suggestions", ["user_id"])
    op.create_index("ix_networth_suggestions_status", "networth_suggestions", ["status"])


def downgrade() -> None:
    op.drop_index("ix_networth_suggestions_status", table_name="networth_suggestions")
    op.drop_index("ix_networth_suggestions_user_id", table_name="networth_suggestions")
    op.drop_table("networth_suggestions")
