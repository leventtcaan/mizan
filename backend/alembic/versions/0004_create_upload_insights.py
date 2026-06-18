"""create upload_insights table

Revision ID: 0004
Revises: 0003
Create Date: 2026-06-18

WHAT: Adds upload_insights table to cache LLM-generated coaching insights per batch.
WHY: Prevents redundant LLM calls on every /insights page load. Cache key is
     upload_batch_id — a new upload automatically misses the cache.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "upload_insights",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("upload_batch_id", sa.String(36), nullable=False),
        sa.Column("insight_text", sa.Text, nullable=False),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_upload_insights_user_id", "upload_insights", ["user_id"])
    op.create_index("ix_upload_insights_upload_batch_id", "upload_insights", ["upload_batch_id"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_upload_insights_upload_batch_id", table_name="upload_insights")
    op.drop_index("ix_upload_insights_user_id", table_name="upload_insights")
    op.drop_table("upload_insights")
