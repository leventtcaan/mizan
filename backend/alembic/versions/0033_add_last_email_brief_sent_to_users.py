"""add last_email_brief_sent to users

Revision ID: 0033
Revises: 0032
Create Date: 2026-06-23

WHAT: Adds a nullable `last_email_brief_sent` timestamp to users.
WHY: The weekly "money brief" email job enforces a ~weekly cadence by skipping any
     user emailed within the last 6 days. This column is that bookmark, so a re-run
     of the scheduled job or the manual trigger endpoint can't double-send.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector

revision = "0033"
down_revision = "0032"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = Inspector.from_engine(bind)
    cols = [c["name"] for c in inspector.get_columns("users")]
    if "last_email_brief_sent" not in cols:
        op.add_column(
            "users",
            sa.Column("last_email_brief_sent", sa.DateTime(timezone=True), nullable=True),
        )


def downgrade() -> None:
    op.drop_column("users", "last_email_brief_sent")
