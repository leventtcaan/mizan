"""add upload_batch_id to transactions

Revision ID: 0002
Revises: 0001
Create Date: 2026-06-18

WHAT: Adds upload_batch_id column to transactions table.
WHY: Isolates rows by upload job so the GET /transactions endpoint can return only
     the latest batch by default, and DELETE /transactions/batch/{id} can clear
     a single upload without touching others.
"""

from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "transactions",
        sa.Column("upload_batch_id", sa.String(length=36), nullable=True),
    )
    # WHY: Index added separately so Alembic generates it with a predictable name.
    # Queries filtering by upload_batch_id (latest batch, delete batch) run on every
    # page load — without this index they'd do full table scans.
    op.create_index("ix_transactions_upload_batch_id", "transactions", ["upload_batch_id"])


def downgrade() -> None:
    op.drop_index("ix_transactions_upload_batch_id", table_name="transactions")
    op.drop_column("transactions", "upload_batch_id")
