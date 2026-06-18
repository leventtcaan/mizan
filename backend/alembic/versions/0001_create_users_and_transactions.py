"""create users and transactions tables

Revision ID: 0001
Revises:
Create Date: 2026-06-18

WHAT: Initial schema — users and transactions tables.
WHY: Establishes the core data model for Phase 1. UUID PKs, timezone-aware timestamps,
     and CASCADE delete ensure data integrity from the start.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    op.create_table(
        "transactions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("amount", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("transaction_type", sa.String(length=10), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("transaction_date", sa.Date(), nullable=False),
        sa.Column("category", sa.String(length=100), nullable=True),
        sa.Column("behavioral_tag", sa.String(length=100), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_transactions_user_id", "transactions", ["user_id"], unique=False)
    op.create_index("ix_transactions_transaction_date", "transactions", ["transaction_date"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_transactions_transaction_date", table_name="transactions")
    op.drop_index("ix_transactions_user_id", table_name="transactions")
    op.drop_table("transactions")
    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")
