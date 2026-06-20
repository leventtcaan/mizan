"""create behavioral_profiles table

Revision ID: 0010
Revises: 0009
Create Date: 2026-06-20

WHAT: Adds behavioral_profiles — one row per user storing accumulated financial facts
      extracted from chat messages (fixed expenses, income sources, spending patterns).
WHY: Makes the AI coach aware of user context across sessions. Without this, the coach
     forgets that a user pays 8000 TL rent every time they start a new chat.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "behavioral_profiles",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("fixed_expenses", sa.Text, nullable=True),
        sa.Column("income_sources", sa.Text, nullable=True),
        sa.Column("spending_patterns", sa.Text, nullable=True),
        sa.Column("user_notes", sa.Text, nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", name="uq_behavioral_profiles_user"),
    )
    op.create_index("ix_behavioral_profiles_user_id", "behavioral_profiles", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_behavioral_profiles_user_id", table_name="behavioral_profiles")
    op.drop_table("behavioral_profiles")
