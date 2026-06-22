"""add display_currency to users

Revision ID: 0029
Revises: 0028
Create Date: 2026-06-22
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector

revision = "0029"
down_revision = "0028"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = Inspector.from_engine(bind)
    cols = [c["name"] for c in inspector.get_columns("users")]
    if "display_currency" not in cols:
        op.add_column(
            "users",
            sa.Column("display_currency", sa.String(10), nullable=False, server_default="TRY"),
        )


def downgrade() -> None:
    op.drop_column("users", "display_currency")
