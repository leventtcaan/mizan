"""add paddle_subscription_id + paddle_customer_id to users

Revision ID: 0044
Revises: 0043
Create Date: 2026-06-26

WHAT: Adds to `users`:
      - paddle_subscription_id (varchar(64), null) — Paddle subscription id (sub_…)
      - paddle_customer_id (varchar(64), null) — Paddle customer id (ctm_…)
WHY:  Persist the Paddle identifiers so the billing webhook can correlate events back
      to a user and so /billing/cancel can call the Paddle API for the right subscription.
      Both nullable — additive, existing rows unaffected. Idempotent guards mirror earlier
      migrations.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector

revision = "0044"
down_revision = "0043"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = Inspector.from_engine(bind)
    cols = [c["name"] for c in inspector.get_columns("users")]

    if "paddle_subscription_id" not in cols:
        op.add_column("users", sa.Column("paddle_subscription_id", sa.String(length=64), nullable=True))
    if "paddle_customer_id" not in cols:
        op.add_column("users", sa.Column("paddle_customer_id", sa.String(length=64), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "paddle_customer_id")
    op.drop_column("users", "paddle_subscription_id")
