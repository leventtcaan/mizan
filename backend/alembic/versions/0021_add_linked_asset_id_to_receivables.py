"""add linked_asset_id to receivables

Revision ID: 0021
Revises: 0020
Create Date: 2026-06-21
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "receivables",
        sa.Column(
            "linked_asset_id",
            UUID(as_uuid=True),
            sa.ForeignKey("assets.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_receivables_linked_asset_id", "receivables", ["linked_asset_id"])


def downgrade() -> None:
    op.drop_index("ix_receivables_linked_asset_id", table_name="receivables")
    op.drop_column("receivables", "linked_asset_id")
