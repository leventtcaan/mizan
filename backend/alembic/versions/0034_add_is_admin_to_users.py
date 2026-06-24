"""add is_admin to users

Revision ID: 0034
Revises: 0033
Create Date: 2026-06-24

WHAT: Adds a non-null boolean `is_admin` to users (server_default false).
WHY: Gates the founder admin panel at /admin. Only users with is_admin=True can
     reach any /admin/* endpoint. Defaults false so the migration is safe on
     existing rows and no one becomes an admin implicitly — promotion is explicit.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector

revision = "0034"
down_revision = "0033"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = Inspector.from_engine(bind)
    cols = [c["name"] for c in inspector.get_columns("users")]
    if "is_admin" not in cols:
        op.add_column(
            "users",
            sa.Column(
                "is_admin",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("false"),
            ),
        )


def downgrade() -> None:
    op.drop_column("users", "is_admin")
