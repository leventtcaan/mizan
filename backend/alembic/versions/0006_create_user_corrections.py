"""create user_corrections table

Revision ID: 0006
Revises: 0005
Create Date: 2026-06-18

WHAT: Tracks every time a user manually corrects an AI-assigned category.
WHY: Correction history is prepended to the coaching prompt so the LLM
     learns the user's actual mental model of their spending categories.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_corrections",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "transaction_id",
            UUID(as_uuid=True),
            sa.ForeignKey("transactions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("old_category", sa.String(100), nullable=True),
        sa.Column("new_category", sa.String(100), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_user_corrections_transaction_id", "user_corrections", ["transaction_id"])
    op.create_index("ix_user_corrections_user_id", "user_corrections", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_user_corrections_user_id", table_name="user_corrections")
    op.drop_index("ix_user_corrections_transaction_id", table_name="user_corrections")
    op.drop_table("user_corrections")
