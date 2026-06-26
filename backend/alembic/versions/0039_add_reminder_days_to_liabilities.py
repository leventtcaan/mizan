"""add reminder_days to liabilities

Revision ID: 0039
Revises: 0038
Create Date: 2026-06-26

WHAT: Adds `reminder_days` (int, default 7) to `liabilities` — how many days before the
      monthly due date the app should warn the user about the upcoming payment.
WHY:  A liability with a monthly payment + due date is a living obligation. The
      notification engine reads this per-liability lead time (instead of a hardcoded 7)
      so each debt can warn on its own schedule. Existing rows default to 7. Idempotent
      guard mirrors earlier migrations (dev create_all may have already added it).
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector

revision = "0039"
down_revision = "0038"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = Inspector.from_engine(bind)
    cols = [c["name"] for c in inspector.get_columns("liabilities")]
    if "reminder_days" not in cols:
        op.add_column(
            "liabilities",
            sa.Column("reminder_days", sa.Integer(), nullable=False, server_default=sa.text("7")),
        )


def downgrade() -> None:
    op.drop_column("liabilities", "reminder_days")
