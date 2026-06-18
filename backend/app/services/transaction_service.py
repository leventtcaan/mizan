"""
WHAT: Maps RawTransaction dataclasses → Transaction ORM rows and bulk-inserts them.
WHY: Keeps the ORM import boundary clean — pdf_parser stays pure (no SQLAlchemy);
     this service is the only place that crosses from parsed data into the DB layer.
BREAKS IF REMOVED: Parsed transactions never reach the database.
"""

import logging
import uuid
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.transaction import Transaction
from app.services.pdf_parser import RawTransaction

logger = logging.getLogger(__name__)

# WHY: Turkish bank statements use DD.MM.YYYY most commonly; other formats appear
# in CSV exports. Tried in order — first match wins.
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
    # WHY: Fall back to today rather than crashing — a bad date row is better
    # than losing all transactions from the upload. Logged so it's visible.
    logger.warning("Could not parse date %r — using today as fallback", raw)
    return date.today()


def _parse_amount(raw: str) -> Decimal:
    """
    WHAT: Converts a raw amount string into a Decimal.
    WHY: pdf_parser already normalises to "1234.56" form (dot as decimal separator),
         but edge cases (empty string, stray characters) still need guarding.
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
) -> list[Transaction]:
    """
    WHAT: Converts RawTransaction list → Transaction ORM objects and bulk-inserts them.
    WHY: add_all + single flush is faster than one commit per row because SQLAlchemy
         batches the INSERT statements into one round-trip.
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
        )
        for rt in raw_transactions
    ]

    session.add_all(rows)
    await session.flush()  # assigns DB-generated defaults (id, created_at) without committing

    logger.info("Inserted %d transactions for user_id=%s", len(rows), user_id)
    return rows


async def get_transactions_for_user(
    user_id: uuid.UUID,
    session: AsyncSession,
) -> list[Transaction]:
    """
    WHAT: Returns all transactions belonging to a user, ordered newest-first.
    WHY: Centralises the query so the API layer stays thin and the sort order
         is consistent regardless of which endpoint calls it.
    BREAKS IF REMOVED: GET /transactions has nowhere to fetch data from.
    """
    result = await session.execute(
        select(Transaction)
        .where(Transaction.user_id == user_id)
        .order_by(Transaction.transaction_date.desc())
    )
    return list(result.scalars().all())
