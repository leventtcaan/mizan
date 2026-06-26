"""alter assets.source_detail String(500) -> Text

Revision ID: 0043
Revises: 0042
Create Date: 2026-06-26

WHAT: Widens `assets.source_detail` from VARCHAR(500) to TEXT.
WHY:  The column stores a JSON string (subtype metadata + accumulated price cache +
      lineage). Once price metadata (last_price_usd, price_fetched_at, …) is merged into
      richer subtypes the payload can exceed 500 chars and PostgreSQL would raise on
      insert / silently break the stored JSON. TEXT has no length cap. No data change —
      the existing values are valid TEXT. Idempotent: only alters when still VARCHAR.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector

revision = "0043"
down_revision = "0042"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = Inspector.from_engine(bind)
    col = next((c for c in inspector.get_columns("assets") if c["name"] == "source_detail"), None)
    # Only alter if the column exists and is not already TEXT (length is set for VARCHAR).
    if col is not None and getattr(col["type"], "length", None) is not None:
        op.alter_column(
            "assets",
            "source_detail",
            existing_type=sa.String(length=500),
            type_=sa.Text(),
            existing_nullable=True,
        )


def downgrade() -> None:
    op.alter_column(
        "assets",
        "source_detail",
        existing_type=sa.Text(),
        type_=sa.String(length=500),
        existing_nullable=True,
    )
