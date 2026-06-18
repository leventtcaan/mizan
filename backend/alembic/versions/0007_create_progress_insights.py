"""create progress_insights table

Revision ID: 0007
Revises: 0006
Create Date: 2026-06-18

WHAT: Adds progress_insights table to cache /insights/progress and /insights/comparison
      results per user. One row per (user_id, data_type) pair — "progress" stores the
      monthly aggregation JSON, "comparison" stores the category-trend JSON with LLM one-liners.
WHY: /insights/comparison makes one LLM call per category on every page refresh without
     this cache. Cache key is a hash of batch_ids so a new upload automatically misses.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "progress_insights",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("data_type", sa.String(20), nullable=False),
        sa.Column("cache_key", sa.String(64), nullable=False),
        sa.Column("data", sa.Text, nullable=False),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "data_type", name="uq_progress_insights_user_type"),
    )
    op.create_index("ix_progress_insights_user_id", "progress_insights", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_progress_insights_user_id", table_name="progress_insights")
    op.drop_table("progress_insights")
