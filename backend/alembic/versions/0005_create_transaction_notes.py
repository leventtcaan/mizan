"""create transaction_notes table

Revision ID: 0005
Revises: 0004
Create Date: 2026-06-18

WHAT: Adds transaction_notes table — per-transaction user annotations.
WHY: Notes are fed into the coaching prompt so the LLM understands
     the user's own context behind specific transactions.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "transaction_notes",
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
        sa.Column("note_text", sa.Text, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_transaction_notes_transaction_id", "transaction_notes", ["transaction_id"])
    op.create_index("ix_transaction_notes_user_id", "transaction_notes", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_transaction_notes_user_id", table_name="transaction_notes")
    op.drop_index("ix_transaction_notes_transaction_id", table_name="transaction_notes")
    op.drop_table("transaction_notes")
