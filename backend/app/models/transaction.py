"""
WHAT: SQLAlchemy ORM model for the `transactions` table — one row per bank transaction.
WHY: Core data unit of the app; every LLM categorization and behavioral insight is derived from these rows.
BREAKS IF REMOVED: No persistent storage for extracted transactions; upload pipeline has nowhere to write.
"""

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.user import Base, User


class Transaction(Base):
    """
    WHAT: Maps the `transactions` table. One row = one line item from a bank statement.
    WHY: Separates raw extracted data (description, amount) from enriched data
         (category, behavioral_tag) so we can re-run LLM enrichment without re-parsing PDFs.
    """

    __tablename__ = "transactions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        nullable=False,
    )

    # WHY: ForeignKey links to users.id — every transaction belongs to one user.
    # ondelete="CASCADE" means deleting the user also deletes their transactions at DB level.
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # WHY: Numeric(12, 2) matches Turkish bank statement precision — up to 10 digits before
    # decimal, exactly 2 after. Float is avoided because binary floating point cannot
    # represent 0.10 exactly, causing silent rounding errors in financial calculations.
    amount: Mapped[Decimal] = mapped_column(
        Numeric(12, 2),
        nullable=False,
    )

    # WHY: Separate debit/credit flag instead of signed amount — Turkish bank statements
    # often print absolute values with a direction column. Signed amount is derived later.
    # ALTERNATIVE: Negative amount = debit. TRADEOFF: Requires callers to know sign convention.
    transaction_type: Mapped[str] = mapped_column(
        String(10),
        nullable=False,
    )

    # WHY: Raw description from the bank statement, unmodified. Preserved so LLM can
    # re-categorize without re-parsing the PDF.
    description: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    # WHY: Date only (not datetime) — Turkish bank statements show date, not time.
    # Using Date avoids false precision and timezone confusion on transaction dates.
    transaction_date: Mapped[date] = mapped_column(
        Date,
        nullable=False,
        index=True,
    )

    # WHY: Ties every row to the upload job that produced it.
    # Nullable for backwards-compatibility with rows inserted before this column existed.
    # Used to isolate and delete a specific upload batch without touching other data.
    upload_batch_id: Mapped[str | None] = mapped_column(
        String(36),  # UUID string, e.g. "550e8400-e29b-41d4-a716-446655440000"
        nullable=True,
        index=True,
    )

    # WHY: Nullable — LLM enrichment happens asynchronously after insert.
    # Row exists with raw data immediately; category is filled by the enrichment job.
    category: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
    )

    # WHY: Behavioral tag is Phase 2 output (e.g. "impulsive_weekend_spend").
    # Stored separately from category so category can be re-run without losing behavioral context.
    behavioral_tag: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    # WHY: ORM relationship lets Python code do `transaction.user` without a manual JOIN.
    # back_populates is intentionally omitted — User model stays minimal until Phase 3.
    user: Mapped["User"] = relationship("User", lazy="selectin")
