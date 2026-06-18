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
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.transaction import Transaction
from app.models.upload_insight import UploadInsight
from app.models.progress_insight import ProgressInsight
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


async def get_latest_batch_id(
    user_id: uuid.UUID,
    session: AsyncSession,
) -> str | None:
    """
    WHAT: Returns the most recent upload_batch_id for the user, or None if no uploads.
    WHY: Extracted from get_transactions_for_user so insight caching can resolve the
         cache key without fetching all transaction rows.
    BREAKS IF REMOVED: Insight cache can't determine which batch to look up.
    """
    result = await session.execute(
        select(Transaction.upload_batch_id)
        .where(Transaction.user_id == user_id)
        .where(Transaction.upload_batch_id.is_not(None))
        .order_by(Transaction.created_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def bust_insight_cache(user_id: uuid.UUID, session: AsyncSession) -> None:
    """
    WHAT: Deletes the cached coaching insight for the user's current batch.
    WHY: Called after a category correction or note is saved so the next /insights
         request regenerates with fresh behavioral context (corrections + notes
         are already injected into the coach prompt by coach.py).
    BREAKS IF REMOVED: Insight cache never reflects user corrections/notes added
         after the initial upload insight was generated.
    """
    batch_id = await get_latest_batch_id(user_id, session)
    if batch_id is None:
        return
    await session.execute(
        delete(UploadInsight).where(UploadInsight.upload_batch_id == batch_id)
    )
    logger.info("Insight cache busted — user_id=%s batch_id=%s", user_id, batch_id)


def dedup_transactions_orm(transactions: list[Transaction]) -> list[Transaction]:
    """
    WHAT: Deduplicates ORM Transaction rows using (transaction_date, amount, description[:30]).
    WHY: Users may upload the same statement twice or upload overlapping date ranges.
         The progress page aggregates across ALL batches, so without dedup each overlap
         is counted twice — inflating spending totals and poisoning coaching insights.
         Same key logic as pdf_parser._deduplicate() but operates on ORM objects.
    """
    seen: set[tuple] = set()
    result: list[Transaction] = []
    for t in transactions:
        key = (str(t.transaction_date), str(t.amount), t.description[:30])
        if key not in seen:
            seen.add(key)
            result.append(t)
    removed = len(transactions) - len(result)
    if removed:
        logger.info("Progress: removed %d duplicate transaction(s) across batches", removed)
    return result


async def get_batch_summaries(
    user_id: uuid.UUID,
    session: AsyncSession,
) -> list[dict[str, Any]]:
    """
    WHAT: Returns one metadata dict per upload batch for a user, ordered newest-first.
    WHY: Frontend needs to show which batch is currently displayed and allow toggling
         to see all batches. Aggregated here so the API returns O(batches) rows,
         not O(transactions) rows.
    """
    result = await session.execute(
        select(Transaction)
        .where(Transaction.user_id == user_id)
        .where(Transaction.upload_batch_id.is_not(None))
    )
    all_txs = result.scalars().all()

    batches: dict[str, dict[str, Any]] = {}
    for t in all_txs:
        bid = t.upload_batch_id
        assert bid is not None
        if bid not in batches:
            batches[bid] = {
                "batch_id": bid,
                "uploaded_at": t.created_at,
                "transaction_count": 0,
                "min_date": t.transaction_date,
                "max_date": t.transaction_date,
            }
        batches[bid]["transaction_count"] += 1
        if t.transaction_date < batches[bid]["min_date"]:
            batches[bid]["min_date"] = t.transaction_date
        if t.transaction_date > batches[bid]["max_date"]:
            batches[bid]["max_date"] = t.transaction_date

    return sorted(batches.values(), key=lambda x: x["uploaded_at"], reverse=True)


async def bust_progress_cache(user_id: uuid.UUID, session: AsyncSession) -> None:
    """
    WHAT: Deletes all cached progress/comparison rows for the user.
    WHY: Called after a category correction (changes category aggregation → comparison_data
         is now wrong) or after a new upload (batch_ids change → cache_key auto-misses,
         but we bust eagerly to avoid serving stale data on the first post-upload load).
    BREAKS IF REMOVED: Category corrections don't invalidate comparison charts — user sees
         stale LLM one-liners and wrong totals after correcting a category.
    """
    await session.execute(
        delete(ProgressInsight).where(ProgressInsight.user_id == user_id)
    )
    logger.info("Progress cache busted — user_id=%s", user_id)


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
