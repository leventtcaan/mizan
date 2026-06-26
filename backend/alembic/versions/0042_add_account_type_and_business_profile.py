"""add account_type + business profile + phone/timezone to users

Revision ID: 0042
Revises: 0041
Create Date: 2026-06-26

WHAT: Adds to `users`:
      - account_type (varchar(20), default "personal") — durable personal/business flag
      - company_name (varchar(160), null), industry (varchar(60), null),
        team_size (varchar(20), null) — business profile
      - phone (varchar(40), null) — optional contact
      - timezone (varchar(60), null) — IANA tz auto-detected from the browser
WHY:  Persist the profile that previously lived only in localStorage, so dashboard
      emphasis (business vs personal) and personalization survive across devices, and
      business users can record company details. All nullable / defaulted — additive,
      existing rows unaffected. Idempotent guards mirror earlier migrations.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector

revision = "0042"
down_revision = "0041"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = Inspector.from_engine(bind)
    cols = [c["name"] for c in inspector.get_columns("users")]

    if "account_type" not in cols:
        op.add_column(
            "users",
            sa.Column("account_type", sa.String(length=20), nullable=False, server_default="personal"),
        )
    if "company_name" not in cols:
        op.add_column("users", sa.Column("company_name", sa.String(length=160), nullable=True))
    if "industry" not in cols:
        op.add_column("users", sa.Column("industry", sa.String(length=60), nullable=True))
    if "team_size" not in cols:
        op.add_column("users", sa.Column("team_size", sa.String(length=20), nullable=True))
    if "phone" not in cols:
        op.add_column("users", sa.Column("phone", sa.String(length=40), nullable=True))
    if "timezone" not in cols:
        op.add_column("users", sa.Column("timezone", sa.String(length=60), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "timezone")
    op.drop_column("users", "phone")
    op.drop_column("users", "team_size")
    op.drop_column("users", "industry")
    op.drop_column("users", "company_name")
    op.drop_column("users", "account_type")
