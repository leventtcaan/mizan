"""add referral_code + referred_by to users

Revision ID: 0047
Revises: 0046
Create Date: 2026-07-07

WHAT: Adds to `users`:
      - referral_code (varchar(12), unique, indexed, null) — the user's shareable code
      - referred_by (uuid, indexed, null) — who referred this account (plain UUID, no FK:
        the stat should survive the referrer's deletion)
WHY:  Referral program — clarifin.xyz/join?ref=CODE. Nullable so existing rows are
      untouched; codes are generated lazily (registration for new users, first
      referral-info read for existing ones). Idempotent guards mirror earlier migrations.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.engine.reflection import Inspector

revision = "0047"
down_revision = "0046"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = Inspector.from_engine(bind)
    cols = [c["name"] for c in inspector.get_columns("users")]

    if "referral_code" not in cols:
        op.add_column("users", sa.Column("referral_code", sa.String(length=12), nullable=True))
        op.create_index("ix_users_referral_code", "users", ["referral_code"], unique=True)
    if "referred_by" not in cols:
        op.add_column("users", sa.Column("referred_by", UUID(as_uuid=True), nullable=True))
        op.create_index("ix_users_referred_by", "users", ["referred_by"])


def downgrade() -> None:
    op.drop_index("ix_users_referred_by", table_name="users")
    op.drop_column("users", "referred_by")
    op.drop_index("ix_users_referral_code", table_name="users")
    op.drop_column("users", "referral_code")
