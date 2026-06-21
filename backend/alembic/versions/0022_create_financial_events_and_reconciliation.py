"""create financial events and reconciliation items

Revision ID: 0022
Revises: 0021
Create Date: 2026-06-21
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0022"
down_revision = "0021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not inspector.has_table("financial_events"):
        op.create_table(
            "financial_events",
            sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
            sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("event_type", sa.String(50), nullable=False),
            sa.Column("entity_type", sa.String(50), nullable=False),
            sa.Column("entity_id", UUID(as_uuid=True), nullable=True),
            sa.Column("amount", sa.Numeric(18, 2), nullable=True),
            sa.Column("currency", sa.String(10), nullable=True),
            sa.Column("event_date", sa.Date, nullable=False),
            sa.Column("source", sa.String(50), nullable=False, server_default="system"),
            sa.Column("source_detail", sa.Text, nullable=True),
            sa.Column("status", sa.String(20), nullable=False, server_default="confirmed"),
            sa.Column("confidence", sa.Numeric(5, 4), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index("ix_financial_events_user_id", "financial_events", ["user_id"])
        op.create_index("ix_financial_events_event_type", "financial_events", ["event_type"])
        op.create_index("ix_financial_events_entity_type", "financial_events", ["entity_type"])
        op.create_index("ix_financial_events_event_date", "financial_events", ["event_date"])
        op.create_index("ix_financial_events_status", "financial_events", ["status"])

    if not inspector.has_table("reconciliation_items"):
        op.create_table(
            "reconciliation_items",
            sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
            sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("issue_type", sa.String(50), nullable=False),
            sa.Column("severity", sa.String(20), nullable=False, server_default="medium"),
            sa.Column("status", sa.String(20), nullable=False, server_default="open"),
            sa.Column("title", sa.String(200), nullable=False),
            sa.Column("description", sa.Text, nullable=False),
            sa.Column("related_event_id", UUID(as_uuid=True), sa.ForeignKey("financial_events.id", ondelete="SET NULL"), nullable=True),
            sa.Column("related_entity_type", sa.String(50), nullable=True),
            sa.Column("related_entity_id", UUID(as_uuid=True), nullable=True),
            sa.Column("proposed_action", sa.Text, nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_reconciliation_items_user_id", "reconciliation_items", ["user_id"])
        op.create_index("ix_reconciliation_items_issue_type", "reconciliation_items", ["issue_type"])
        op.create_index("ix_reconciliation_items_status", "reconciliation_items", ["status"])


def downgrade() -> None:
    op.drop_index("ix_reconciliation_items_status", table_name="reconciliation_items")
    op.drop_index("ix_reconciliation_items_issue_type", table_name="reconciliation_items")
    op.drop_index("ix_reconciliation_items_user_id", table_name="reconciliation_items")
    op.drop_table("reconciliation_items")

    op.drop_index("ix_financial_events_status", table_name="financial_events")
    op.drop_index("ix_financial_events_event_date", table_name="financial_events")
    op.drop_index("ix_financial_events_entity_type", table_name="financial_events")
    op.drop_index("ix_financial_events_event_type", table_name="financial_events")
    op.drop_index("ix_financial_events_user_id", table_name="financial_events")
    op.drop_table("financial_events")
