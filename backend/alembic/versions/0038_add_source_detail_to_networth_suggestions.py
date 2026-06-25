"""add source_detail to networth_suggestions

Revision ID: 0038
Revises: 0037
Create Date: 2026-06-26

WHAT: Adds a nullable `source_detail` (text/JSON) column to networth_suggestions.
WHY:  The statement → net-worth bridge needs to carry structured context
      (institution, statement_kind, proposed_name, matched_asset_name) from the
      moment a statement is parsed to the moment the user accepts the suggestion,
      so accept can create a correctly-named asset/liability deterministically.
      Idempotent guard mirrors earlier migrations (dev create_all may pre-add it).
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector

revision = "0038"
down_revision = "0037"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = Inspector.from_engine(bind)
    cols = [c["name"] for c in inspector.get_columns("networth_suggestions")]
    if "source_detail" not in cols:
        op.add_column("networth_suggestions", sa.Column("source_detail", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("networth_suggestions", "source_detail")
