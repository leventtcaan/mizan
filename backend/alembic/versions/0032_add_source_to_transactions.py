"""add source to transactions

Revision ID: 0032
Revises: 0031
Create Date: 2026-06-23

WHAT: Adds a `source` column to transactions so every row records how it entered
      the system: parsed from a statement, a user estimate, a confirmed value, or a
      supplementary cash entry. WHY: enables honest figures — the app can tell the user
      (and the AI coach) which numbers are real and which are rough estimates, and the
      conflict engine can avoid double-counting estimates against parsed statement data.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector

revision = "0032"
down_revision = "0031"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = Inspector.from_engine(bind)
    cols = [c["name"] for c in inspector.get_columns("transactions")]
    if "source" not in cols:
        op.add_column(
            "transactions",
            sa.Column(
                "source",
                sa.String(30),
                nullable=False,
                server_default="statement_parsed",
            ),
        )


def downgrade() -> None:
    op.drop_column("transactions", "source")
