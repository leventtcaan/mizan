"""add registration profile + consent fields to users

Revision ID: 0037
Revises: 0036
Create Date: 2026-06-26

WHAT: Adds six columns to `users`:
      - full_name (varchar(120), null)        — personalization / future billing
      - country (varchar(2), null)            — ISO residence code; currency + privacy regime
      - marketing_consent (bool, default false) — explicit, unbundled, OFF by default (GDPR/KVKK)
      - tos_accepted_at (timestamptz, null)   — provable consent timestamp
      - tos_version (varchar(20), null)        — which policy version was accepted
      - primary_goal (varchar(40), null)      — user intent captured in onboarding
WHY:  Registration data strategy — personalization, BI, compliance (auditable ToS +
      marketing consent), and future SME/localization features. Existing rows keep
      NULL/false defaults (no retroactive consent is implied). Idempotent guards mirror
      earlier migrations (dev create_all may have already added the columns).
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector

revision = "0037"
down_revision = "0036"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = Inspector.from_engine(bind)
    cols = [c["name"] for c in inspector.get_columns("users")]

    if "full_name" not in cols:
        op.add_column("users", sa.Column("full_name", sa.String(length=120), nullable=True))
    if "country" not in cols:
        op.add_column("users", sa.Column("country", sa.String(length=2), nullable=True))
    if "marketing_consent" not in cols:
        op.add_column(
            "users",
            sa.Column("marketing_consent", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        )
    if "tos_accepted_at" not in cols:
        op.add_column("users", sa.Column("tos_accepted_at", sa.DateTime(timezone=True), nullable=True))
    if "tos_version" not in cols:
        op.add_column("users", sa.Column("tos_version", sa.String(length=20), nullable=True))
    if "primary_goal" not in cols:
        op.add_column("users", sa.Column("primary_goal", sa.String(length=40), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "primary_goal")
    op.drop_column("users", "tos_version")
    op.drop_column("users", "tos_accepted_at")
    op.drop_column("users", "marketing_consent")
    op.drop_column("users", "country")
    op.drop_column("users", "full_name")
