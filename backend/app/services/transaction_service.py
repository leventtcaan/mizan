"""
WHAT: Maps RawTransaction dataclasses → Transaction ORM rows and bulk-inserts them.
      Also provides batch-scoped queries and batch deletion for upload isolation.
WHY: Keeps the ORM import boundary clean — pdf_parser stays pure (no SQLAlchemy);
     this service is the only place that crosses from parsed data into the DB layer.
BREAKS IF REMOVED: Parsed transactions never reach the database.
"""

import logging
import uuid
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.transaction import Transaction
from app.services.pdf_parser import RawTransaction

logger = logging.getLogger(__name__)

_DATE_FORMATS = [
    "%d.%m.%Y",
    "%d/%m/%Y",
    "%Y-%m-%d",
    "%d-%m-%Y",
    "%d.%m.%y",
]


def _parse_date(raw: str) -> date:
    """
    WHAT: Converts a raw date string from a bank statement into a Python date.
    WHY: Turkish statements use DD.MM.YYYY; CSV exports may vary. Trying multiple
         formats avoids crashing on legitimate but differently-formatted statements.
    BREAKS IF REMOVED: transaction_date is always None; DB rejects nullable=False column.
    """
    cleaned = raw.strip()
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(cleaned, fmt).date()
        except ValueError:
            continue
    logger.warning("Could not parse date %r — using today as fallback", raw)
    return date.today()


def _parse_amount(raw: str) -> Decimal:
    """
    WHAT: Converts a raw amount string into a Decimal.
    WHY: pdf_parser normalises to "1234.56" form but edge cases (empty string,
         stray OCR characters) still need guarding.
    BREAKS IF REMOVED: Malformed amounts crash the insert; entire upload fails.
    """
    cleaned = raw.strip().replace(" ", "")
    try:
        return Decimal(cleaned)
    except InvalidOperation:
        logger.warning("Could not parse amount %r — defaulting to 0.00", raw)
        return Decimal("0.00")


async def insert_transactions(
    raw_transactions: list[RawTransaction],
    user_id: uuid.UUID,
    session: AsyncSession,
    upload_batch_id: str | None = None,
) -> list[Transaction]:
    """
    WHAT: Converts RawTransaction list → Transaction ORM objects and bulk-inserts them.
    WHY: add_all + single flush batches all INSERTs into one round-trip.
         upload_batch_id tags every row with the job that produced it, enabling
         per-batch isolation on read and per-batch deletion.
    BREAKS IF REMOVED: No way to persist parsed transactions to the database.
    """
    if not raw_transactions:
        return []

    rows = [
        Transaction(
            user_id=user_id,
            amount=_parse_amount(rt.amount),
            transaction_type=rt.transaction_type,
            description=rt.description,
            transaction_date=_parse_date(rt.date),
            upload_batch_id=upload_batch_id,
        )
        for rt in raw_transactions
    ]

    session.add_all(rows)
    await session.flush()

    logger.info(
        "Inserted %d transactions — user_id=%s upload_batch_id=%s",
        len(rows), user_id, upload_batch_id,
    )
    return rows


async def get_transactions_for_user(
    user_id: uuid.UUID,
    session: AsyncSession,
    all_batches: bool = False,
) -> list[Transaction]:
    """
    WHAT: Returns transactions for a user, scoped to the latest batch by default.
    WHY: Returning all batches by default would mix stale test uploads with the
         current statement — confusing for the user and noisy for the LLM coach.
         ?all=true is available for debugging and future batch-management UI.
    BREAKS IF REMOVED: GET /transactions has nowhere to fetch data from.
    """
    if all_batches:
        stmt = (
            select(Transaction)
            .where(Transaction.user_id == user_id)
            .order_by(Transaction.transaction_date.desc())
        )
        result = await session.execute(stmt)
        return list(result.scalars().all())

    # WHY: Find the most recent upload_batch_id for this user, then return only
    # rows from that batch. Rows with upload_batch_id=NULL (pre-migration data)
    # are treated as a single implicit batch and returned when no newer batch exists.
    latest_batch_stmt = (
        select(Transaction.upload_batch_id)
        .where(Transaction.user_id == user_id)
        .where(Transaction.upload_batch_id.is_not(None))
        .order_by(Transaction.created_at.desc())
        .limit(1)
    )
    latest_result = await session.execute(latest_batch_stmt)
    latest_batch_id = latest_result.scalar_one_or_none()

    if latest_batch_id is None:
        # No batched rows found — fall back to all rows (handles pre-migration data)
        stmt = (
            select(Transaction)
            .where(Transaction.user_id == user_id)
            .order_by(Transaction.transaction_date.desc())
        )
    else:
        stmt = (
            select(Transaction)
            .where(Transaction.user_id == user_id)
            .where(Transaction.upload_batch_id == latest_batch_id)
            .order_by(Transaction.transaction_date.desc())
        )

    result = await session.execute(stmt)
    return list(result.scalars().all())


async def delete_batch(
    upload_batch_id: str,
    user_id: uuid.UUID,
    session: AsyncSession,
) -> int:
    """
    WHAT: Deletes all transactions belonging to a specific upload batch for a user.
    WHY: user_id is checked in the WHERE clause so one user cannot delete another
         user's batch even if they know the upload_batch_id UUID.
    BREAKS IF REMOVED: No way to undo a bad upload; stale data accumulates indefinitely.
    """
    result = await session.execute(
        delete(Transaction)
        .where(Transaction.upload_batch_id == upload_batch_id)
        .where(Transaction.user_id == user_id)
    )
    deleted = result.rowcount
    await session.commit()
    logger.info(
        "Deleted %d transactions — upload_batch_id=%s user_id=%s",
        deleted, upload_batch_id, user_id,
    )
    return deleted
