"""create assistant_actions

Revision ID: 0027
Revises: 0026
Create Date: 2026-06-22
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector

revision = "0027"
down_revision = "0026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = Inspector.from_engine(bind)
    if inspector.has_table("assistant_actions"):
        return

    op.create_table(
        "assistant_actions",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("action_type", sa.String(50), nullable=False),
        sa.Column("params_json", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="proposed"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_assistant_actions_user_id", "assistant_actions", ["user_id"])
    op.create_index("ix_assistant_actions_created_at", "assistant_actions", ["created_at"])


def downgrade() -> None:
    op.drop_table("assistant_actions")
