"""add action fields to app_notifications

Revision ID: 0041
Revises: 0040
Create Date: 2026-06-26

WHAT: Adds `action_type` (varchar(40), null), `action_data` (text, null) and
      `action_state` (varchar(20), default "none") to `app_notifications`.
WHY:  Proactive "Mim" notifications can ask the user a question and act on the answer
      (e.g. "Did you make your payment?" → yes creates a transaction + reduces the
      balance). These columns carry the action contract + its lifecycle. Existing rows
      default to action_state="none" (plain informational). Idempotent guards mirror
      earlier migrations.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector

revision = "0041"
down_revision = "0040"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = Inspector.from_engine(bind)
    cols = [c["name"] for c in inspector.get_columns("app_notifications")]
    if "action_type" not in cols:
        op.add_column("app_notifications", sa.Column("action_type", sa.String(length=40), nullable=True))
    if "action_data" not in cols:
        op.add_column("app_notifications", sa.Column("action_data", sa.Text(), nullable=True))
    if "action_state" not in cols:
        op.add_column(
            "app_notifications",
            sa.Column("action_state", sa.String(length=20), nullable=False, server_default="none"),
        )


def downgrade() -> None:
    op.drop_column("app_notifications", "action_state")
    op.drop_column("app_notifications", "action_data")
    op.drop_column("app_notifications", "action_type")
