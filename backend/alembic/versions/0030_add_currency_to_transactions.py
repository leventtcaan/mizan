"""add currency to transactions

Revision ID: 0030
Revises: 0029
Create Date: 2026-06-22
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector

revision = "0030"
down_revision = "0029"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = Inspector.from_engine(bind)
    cols = [c["name"] for c in inspector.get_columns("transactions")]
    if "currency" not in cols:
        op.add_column(
            "transactions",
            sa.Column("currency", sa.String(10), nullable=False, server_default="TRY"),
        )


def downgrade() -> None:
    op.drop_column("transactions", "currency")
