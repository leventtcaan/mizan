"""add deleted_at to users

Revision ID: 0045
Revises: 0044
Create Date: 2026-07-07

WHAT: Adds `deleted_at` (timestamptz, null) to `users`.
WHY:  User-initiated account deletion is a soft delete with a 30-day recovery window
      (GDPR-compliant "right to erasure" with grace period). `deleted_at` marks when
      the user asked for deletion; a daily purge job hard-deletes rows older than 30
      days. NULL = not deleted (or admin-soft-deleted before this column existed).
      Idempotent guards mirror earlier migrations.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector

revision = "0045"
down_revision = "0044"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = Inspector.from_engine(bind)
    cols = [c["name"] for c in inspector.get_columns("users")]

    if "deleted_at" not in cols:
        op.add_column("users", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "deleted_at")
