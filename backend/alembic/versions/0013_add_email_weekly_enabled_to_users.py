"""add email_weekly_enabled to users

Revision ID: 0013
Revises: 0012
Create Date: 2026-06-20

WHAT: Adds email_weekly_enabled boolean column to users table.
WHY: Lets users opt out of the weekly email summary. Default true so
     existing users receive the email until they explicitly disable it.
"""

from alembic import op
import sqlalchemy as sa

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "email_weekly_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "email_weekly_enabled")
