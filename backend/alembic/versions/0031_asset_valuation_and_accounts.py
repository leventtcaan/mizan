"""asset valuation columns + precision + accounts

Revision ID: 0031
Revises: 0030
Create Date: 2026-06-22

P0: widen assets.current_value to Numeric(28,8) so fractional crypto/gold survive.
P1: add quantity + unit_code for live repricing.
P2: create accounts + assets.account_id.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector

revision = "0031"
down_revision = "0030"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = Inspector.from_engine(bind)

    # --- accounts table (P2) ---
    if not inspector.has_table("accounts"):
        op.create_table(
            "accounts",
            sa.Column("id", sa.UUID(), nullable=False),
            sa.Column("user_id", sa.UUID(), nullable=False),
            sa.Column("name", sa.String(120), nullable=False),
            sa.Column("account_type", sa.String(30), nullable=False, server_default="bank"),
            sa.Column("currency", sa.String(10), nullable=False, server_default="TRY"),
            sa.Column("institution", sa.String(120), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_accounts_user_id", "accounts", ["user_id"])

    asset_cols = [c["name"] for c in inspector.get_columns("assets")]

    # --- precision widen (P0) ---
    op.alter_column(
        "assets", "current_value",
        type_=sa.Numeric(28, 8),
        existing_nullable=False,
    )

    # --- valuation columns (P1) ---
    if "quantity" not in asset_cols:
        op.add_column("assets", sa.Column("quantity", sa.Numeric(28, 8), nullable=True))
    if "unit_code" not in asset_cols:
        op.add_column("assets", sa.Column("unit_code", sa.String(20), nullable=True))

    # --- asset → account link (P2) ---
    if "account_id" not in asset_cols:
        op.add_column("assets", sa.Column("account_id", sa.UUID(), nullable=True))
        op.create_foreign_key(
            "fk_assets_account_id", "assets", "accounts",
            ["account_id"], ["id"], ondelete="SET NULL",
        )
        op.create_index("ix_assets_account_id", "assets", ["account_id"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = Inspector.from_engine(bind)
    asset_cols = [c["name"] for c in inspector.get_columns("assets")]
    if "account_id" in asset_cols:
        op.drop_constraint("fk_assets_account_id", "assets", type_="foreignkey")
        op.drop_index("ix_assets_account_id", "assets")
        op.drop_column("assets", "account_id")
    if "unit_code" in asset_cols:
        op.drop_column("assets", "unit_code")
    if "quantity" in asset_cols:
        op.drop_column("assets", "quantity")
    op.alter_column("assets", "current_value", type_=sa.Numeric(18, 2), existing_nullable=False)
    if inspector.has_table("accounts"):
        op.drop_table("accounts")
