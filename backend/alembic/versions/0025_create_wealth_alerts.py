"""Create wealth_alerts table

Revision ID: 0025
Revises: 0024
Create Date: 2026-06-22
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0025"
down_revision = "0024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table("wealth_alerts"):
        return
    op.create_table(
        "wealth_alerts",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("alert_type", sa.String(50), nullable=False),
        sa.Column("condition_json", sa.Text, nullable=False),
        sa.Column("message_template", sa.String(500), nullable=False),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("triggered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_wealth_alerts_user_id", "wealth_alerts", ["user_id"])
    op.create_index("ix_wealth_alerts_is_active", "wealth_alerts", ["is_active"])


def downgrade() -> None:
    op.drop_index("ix_wealth_alerts_is_active", table_name="wealth_alerts")
    op.drop_index("ix_wealth_alerts_user_id", table_name="wealth_alerts")
    op.drop_table("wealth_alerts")
