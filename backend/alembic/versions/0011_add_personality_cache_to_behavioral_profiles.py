"""add personality_cache to behavioral_profiles

Revision ID: 0011
Revises: 0010
Create Date: 2026-06-20

WHAT: Adds personality_cache (JSON text) and personality_batch_id to behavioral_profiles.
WHY: Personality analysis is a single LLM call over 3 months of data — too expensive
     to run on every page load. Cache by batch_id so it auto-invalidates on new upload.
"""

from alembic import op
import sqlalchemy as sa

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("behavioral_profiles", sa.Column("personality_cache", sa.Text, nullable=True))
    op.add_column("behavioral_profiles", sa.Column("personality_batch_id", sa.String(36), nullable=True))


def downgrade() -> None:
    op.drop_column("behavioral_profiles", "personality_batch_id")
    op.drop_column("behavioral_profiles", "personality_cache")
