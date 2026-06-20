"""create conversation_messages table

Revision ID: 0009
Revises: 0008
Create Date: 2026-06-20

WHAT: Adds conversation_messages — persistent chat history between user and AI coach.
WHY: Without persistence, every page load starts a blank conversation. Memory is the
     core differentiator of Mizan vs static insight pages.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "conversation_messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("role", sa.String(10), nullable=False),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("context_batch_id", sa.String(36), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_conversation_messages_user_id", "conversation_messages", ["user_id"])
    op.create_index("ix_conversation_messages_created_at", "conversation_messages", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_conversation_messages_created_at", table_name="conversation_messages")
    op.drop_index("ix_conversation_messages_user_id", table_name="conversation_messages")
    op.drop_table("conversation_messages")
