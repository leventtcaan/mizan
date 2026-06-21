"""create subscription_flags

Revision ID: 0014
Revises: 0013
Create Date: 2026-06-21

WHAT: Stores user flags (essential/review/cancelled) on detected subscriptions.
WHY: Subscriptions are detected algorithmically on every request — without persistence,
     a flag a user set would vanish on the next load.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "subscription_flags",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("merchant_key", sa.String(100), nullable=False),
        sa.Column("flag", sa.String(20), nullable=False),
        sa.Column(
            "flagged_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint(
            "user_id", "merchant_key", name="uq_subscription_flags_user_merchant"
        ),
    )
    op.create_index("ix_subscription_flags_user_id", "subscription_flags", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_subscription_flags_user_id", table_name="subscription_flags")
    op.drop_table("subscription_flags")
