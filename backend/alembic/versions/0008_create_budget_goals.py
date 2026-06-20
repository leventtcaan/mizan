"""create budget_goals table

Revision ID: 0008
Revises: 0007
Create Date: 2026-06-20

WHAT: Adds budget_goals table — stores one monthly spending limit per (user, category).
WHY: Goal setting feature: users define how much they want to spend per category per month.
     GET /goals/status computes spent_this_month vs monthly_limit in real-time.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "budget_goals",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("category", sa.String(100), nullable=False),
        sa.Column("monthly_limit", sa.Numeric(12, 2), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "category", name="uq_budget_goals_user_category"),
    )
    op.create_index("ix_budget_goals_user_id", "budget_goals", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_budget_goals_user_id", table_name="budget_goals")
    op.drop_table("budget_goals")
