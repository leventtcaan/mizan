"""add breakdown_json to networth_snapshots

Revision ID: 0028
Revises: 0027
Create Date: 2026-06-22
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector

revision = "0028"
down_revision = "0027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = Inspector.from_engine(bind)
    cols = [c["name"] for c in inspector.get_columns("networth_snapshots")]
    if "breakdown_json" not in cols:
        op.add_column("networth_snapshots", sa.Column("breakdown_json", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("networth_snapshots", "breakdown_json")
