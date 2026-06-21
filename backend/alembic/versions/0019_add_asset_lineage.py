"""add asset lineage columns

Revision ID: 0019
Revises: 0018
Create Date: 2026-06-21
"""

from alembic import op
import sqlalchemy as sa

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("assets", sa.Column("source", sa.String(50), nullable=False, server_default="manual"))
    op.add_column("assets", sa.Column("source_detail", sa.String(500), nullable=True))
    op.add_column("assets", sa.Column("as_of_date", sa.Date, nullable=False, server_default=sa.text("CURRENT_DATE")))


def downgrade() -> None:
    op.drop_column("assets", "as_of_date")
    op.drop_column("assets", "source_detail")
    op.drop_column("assets", "source")
