"""add user soft-delete flag + admin audit log

Revision ID: 0035
Revises: 0034
Create Date: 2026-06-24

WHAT: Adds a non-null boolean `is_deleted` to users (server_default false) and creates
      the `admin_audit_logs` table.
WHY: The admin panel now soft-deletes accounts (set is_deleted) instead of always
     hard-deleting, and records every delete/restore in a durable audit trail before
     any destructive action. Idempotent guards mirror earlier migrations (dev create_all
     may have already added the column/table).
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.engine.reflection import Inspector

revision = "0035"
down_revision = "0034"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = Inspector.from_engine(bind)

    cols = [c["name"] for c in inspector.get_columns("users")]
    if "is_deleted" not in cols:
        op.add_column(
            "users",
            sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        )

    if "admin_audit_logs" not in inspector.get_table_names():
        op.create_table(
            "admin_audit_logs",
            sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
            sa.Column("admin_user_id", UUID(as_uuid=True), nullable=False),
            sa.Column("admin_email", sa.String(length=255), nullable=True),
            sa.Column("action", sa.String(length=50), nullable=False),
            sa.Column("target_user_id", UUID(as_uuid=True), nullable=True),
            sa.Column("target_email", sa.String(length=255), nullable=True),
            sa.Column("detail", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index("ix_admin_audit_logs_admin_user_id", "admin_audit_logs", ["admin_user_id"])
        op.create_index("ix_admin_audit_logs_target_user_id", "admin_audit_logs", ["target_user_id"])


def downgrade() -> None:
    op.drop_index("ix_admin_audit_logs_target_user_id", table_name="admin_audit_logs")
    op.drop_index("ix_admin_audit_logs_admin_user_id", table_name="admin_audit_logs")
    op.drop_table("admin_audit_logs")
    op.drop_column("users", "is_deleted")
