"""add password_hash to users

Revision ID: 0003
Revises: 0002
Create Date: 2026-06-18

WHAT: Adds password_hash column to users table for Phase 4 JWT auth.
WHY: Users need a stored bcrypt hash to authenticate with POST /auth/login.
     Nullable so existing rows (including the dev seed user) remain valid.
"""

from alembic import op
import sqlalchemy as sa

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("password_hash", sa.String(length=255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "password_hash")
