"""create dismissed_alerts table

Revision ID: 0012
Revises: 0011
Create Date: 2026-06-20

WHAT: Adds dismissed_alerts — records which pattern alerts a user has dismissed.
WHY: Pattern detection re-runs algorithmically on every request. Without this table,
     dismissed alerts would resurface on every page reload.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "dismissed_alerts",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("dismiss_key", sa.String(100), nullable=False),
        sa.Column("dismissed_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "dismiss_key", name="uq_dismissed_alerts_user_key"),
    )
    op.create_index("ix_dismissed_alerts_user_id", "dismissed_alerts", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_dismissed_alerts_user_id", table_name="dismissed_alerts")
    op.drop_table("dismissed_alerts")
