"""add email verification + subscription plan to users

Revision ID: 0036
Revises: 0035
Create Date: 2026-06-25

WHAT: Adds three columns to `users`:
      - email_verified (bool, default false) — gates upload/AI until the email is confirmed
      - plan (varchar(10), default 'free')   — subscription tier free|plus|pro
      - plan_expires_at (timestamptz, null)  — when a paid plan lapses
WHY:  Pre-production requirements: email verification, a plan system + upload cap.
      Existing rows are GRANDFATHERED to email_verified = true so accounts that
      predate this feature aren't suddenly locked out. Idempotent guards mirror
      earlier migrations (dev create_all may have already added the columns).
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector

revision = "0036"
down_revision = "0035"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = Inspector.from_engine(bind)
    cols = [c["name"] for c in inspector.get_columns("users")]

    if "email_verified" not in cols:
        op.add_column(
            "users",
            sa.Column("email_verified", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        )
        # Grandfather every pre-existing account: they registered before verification
        # existed, so don't retroactively lock them out of upload/AI.
        op.execute("UPDATE users SET email_verified = true")

    if "plan" not in cols:
        op.add_column(
            "users",
            sa.Column("plan", sa.String(length=10), nullable=False, server_default=sa.text("'free'")),
        )

    if "plan_expires_at" not in cols:
        op.add_column(
            "users",
            sa.Column("plan_expires_at", sa.DateTime(timezone=True), nullable=True),
        )


def downgrade() -> None:
    op.drop_column("users", "plan_expires_at")
    op.drop_column("users", "plan")
    op.drop_column("users", "email_verified")
