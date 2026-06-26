"""add end_date to liabilities

Revision ID: 0040
Revises: 0039
Create Date: 2026-06-26

WHAT: Adds `end_date` (date, nullable) to `liabilities` — the final month a recurring
      monthly payment is due (loan payoff). `due_date` keeps acting as the monthly
      payment-day anchor (only its day-of-month is read); `end_date` bounds the recurrence.
WHY:  A recurring obligation should stop appearing on the cash-flow calendar and stop
      generating reminders once it's paid off. Optional — null means open-ended (e.g. a
      credit card). Idempotent guard mirrors earlier migrations.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector

revision = "0040"
down_revision = "0039"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = Inspector.from_engine(bind)
    cols = [c["name"] for c in inspector.get_columns("liabilities")]
    if "end_date" not in cols:
        op.add_column("liabilities", sa.Column("end_date", sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column("liabilities", "end_date")
