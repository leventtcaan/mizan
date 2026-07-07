"""create feedback table

Revision ID: 0046
Revises: 0045
Create Date: 2026-07-07

WHAT: `feedback` — user-submitted bug reports / suggestions / other.
      user_id nullable FK (SET NULL) so feedback survives account deletion.
WHY:  Durable inbox for user feedback, listed in the admin panel; each submission
      also fires an email notification to the founder. Idempotent guard mirrors
      earlier migrations (dev create_all may have created it first).
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.engine.reflection import Inspector

revision = "0046"
down_revision = "0045"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = Inspector.from_engine(bind)
    if inspector.has_table("feedback"):
        return

    op.create_table(
        "feedback",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "user_id", UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("category", sa.String(length=20), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_feedback_user_id", "feedback", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_feedback_user_id", table_name="feedback")
    op.drop_table("feedback")
