"""add onboarding_completed to users

Revision ID: 0015
Revises: 0014
Create Date: 2026-06-21

WHAT: Adds onboarding_completed boolean column to users table.
WHY: Tracks whether user has completed the first-run wizard so they're not
     re-shown it on every login. Default false so existing users see it once
     (they'll complete and dismiss it, then never see it again).
"""

from alembic import op
import sqlalchemy as sa

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "onboarding_completed",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "onboarding_completed")
