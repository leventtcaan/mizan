"""
WHAT: POST /upload endpoint — accepts a PDF or CSV bank statement, persists transactions,
      triggers LLM categorization, and returns a job_id with counts.
WHY: Decouples file receipt from display. The endpoint completes synchronously in Phase 2
     (parse + insert + categorize happen in-request); Phase 3 will move categorization
     to a background worker when volumes grow.
BREAKS IF REMOVED: No way for the frontend to submit bank statements.
"""

import json
import uuid
import logging
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from pydantic import BaseModel, field_validator
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_session
from app.core.dependencies import get_current_user, get_verified_user
from app.core.plans import FREE_MONTHLY_UPLOAD_CAP, effective_plan, vision_enabled
from app.core.rate_limiter import upload_ip_limiter, upload_user_limiter
from app.models.progress_insight import ProgressInsight
from app.models.reconciliation_item import ReconciliationItem
from app.models.transaction import Transaction
from app.models.user import User
from app.services.brief import build_brief
from app.services.categorizer import categorize_batch
from app.services.llm_provider import get_provider
from app.services.pdf_parser import parse_statement
from app.services.conflict_detection import BatchInfo, find_duplicate_batch
from app.services.transaction_service import (
    bust_insight_cache,
    bust_progress_cache,
    get_batch_summaries,
    insert_transactions,
)

# Categories the review table is allowed to assign (mirrors transactions.VALID_CATEGORIES).
_VALID_CATEGORIES = {
    "market", "restoran", "ulasim", "eglence", "saglik", "fatura",
    "giyim", "nakit_atm", "transfer", "faiz", "iade", "vergi", "teknoloji", "diger", "egitim",
}

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/upload", tags=["upload"])

MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024

ALLOWED_CONTENT_TYPES = {
    "application/pdf",
    "text/csv",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",  # .xlsx
}

# Accept by extension too — browsers/OSes sometimes send xlsx/csv as octet-stream.
ALLOWED_EXTENSIONS = (".pdf", ".csv", ".xlsx")


class SuggestionOut(BaseModel):
    id: str
    suggestion_type: str
    asset_id: str | None
    suggested_change: str
    currency: str
    reason: str
    source_batch_id: str | None
    status: str
    created_at: datetime


class UploadResponse(BaseModel):
    job_id: str
    filename: str
    transaction_count: int
    status: str = "success"      # "success" | "empty" | "failed"
    reason: str | None = None    # machine code when not success (see pdf_parser)
    message: str
    suggestions: list[SuggestionOut] = []
    # Parsed totals for the period in the statement — powers the onboarding line
    # "We saw X income, Y expenses this month" and conflict detection vs estimates.
    parsed_income: str = "0"
    parsed_expenses: str = "0"
    currency: str = "TRY"
    # True  → currency was read FROM the file (a marker/symbol/column the parser saw).
    # False → no currency in the file; `currency` is an INFERRED fallback (account default)
    #         and must be confirmed by the user in review before it's trusted.
    currency_detected: bool = False


async def _flag_duplicate_batch(
    user_id: uuid.UUID,
    job_id: str,
    persisted: list,
    session: AsyncSession,
) -> None:
    """
    WHAT: After a statement is persisted, check whether it duplicates one already on file
          (same date range + same transaction count) and, if so, flag a reconciliation item.
    WHY: This is the ONLY conflict onboarding cares about now — an accidental re-upload of
         the same statement would double-count every transaction. (Manual income/spending
         entry was removed, so there are no estimate-vs-statement conflicts anymore.)
    """
    dates = [t.transaction_date for t in persisted]
    if not dates:
        return

    new = BatchInfo(
        min_date=str(min(dates)), max_date=str(max(dates)),
        source=None, count=len(persisted),
    )
    summaries = await get_batch_summaries(user_id, session)
    existing = [
        BatchInfo(
            min_date=str(s["min_date"]), max_date=str(s["max_date"]),
            source=None, count=s["transaction_count"],
        )
        for s in summaries if s["batch_id"] != job_id
    ]
    if not existing or not find_duplicate_batch(new, existing):
        return

    item = ReconciliationItem(
        user_id=user_id,
        issue_type="duplicate_statement",
        severity="high",
        status="open",
        title="Possible duplicate statement",
        description=(
            "This statement covers the same dates and the same number of transactions as "
            "one you already uploaded — it may be a duplicate. Review it to avoid "
            "double-counting your transactions."
        ),
        related_entity_type="transaction",
        proposed_action=json.dumps(
            {"action": "delete_batch", "upload_batch_id": job_id}
        ),
    )
    session.add(item)
    logger.info("Duplicate-statement flagged — user_id=%s job_id=%s", user_id, job_id)


async def _uploads_this_month(user_id: uuid.UUID, session: AsyncSession) -> int:
    """Distinct statement batches this calendar month — drives the free-tier cap.
    Only successful uploads create a batch, so failed/empty parses don't count."""
    month_start = datetime.now(timezone.utc).replace(
        day=1, hour=0, minute=0, second=0, microsecond=0
    )
    result = await session.execute(
        select(func.count(func.distinct(Transaction.upload_batch_id)))
        .where(Transaction.user_id == user_id)
        .where(Transaction.upload_batch_id.is_not(None))
        .where(Transaction.created_at >= month_start)
    )
    return int(result.scalar() or 0)


@router.post("", response_model=UploadResponse)
async def upload_statement(
    request: Request,
    file: Annotated[UploadFile, File(description="PDF or CSV bank statement")],
    current_user: User = Depends(get_verified_user),
    session: AsyncSession = Depends(get_session),
) -> UploadResponse:
    """
    WHAT: Full upload pipeline — validate → parse → persist → categorize → commit.
    WHY: All steps run in one DB session so a categorization failure rolls back
         the insert (atomic: either all transactions land with categories or none do).
    BREAKS IF REMOVED: No way to submit bank statements; core app feature unavailable.

    Gated by: email verification (get_verified_user), a 3-per-10-minute rate limit
    per user AND per IP (Redis-backed), and the subscription plan (free tier = one
    statement per calendar month; vision PDF extraction is paid-only).
    """
    user_id_str = str(current_user.id)
    client_ip = request.client.host if request.client else "unknown"

    # 3 uploads per 10 minutes per user (Redis-backed → survives restarts, shared
    # across instances). The same window is applied per IP to blunt shared-account abuse.
    if not upload_user_limiter.is_allowed(user_id_str, max_calls=3, window_seconds=600):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="10 dakikada en fazla 3 yükleme yapılabilir. Lütfen bekleyin.",
        )

    if not upload_ip_limiter.is_allowed(client_ip, max_calls=3, window_seconds=600):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="10 dakikada en fazla 3 yükleme yapılabilir. Lütfen bekleyin.",
        )

    # Free-tier upload cap: one statement per calendar month. Paid plans are unlimited.
    # 402 Payment Required signals the frontend to show the upgrade prompt (not an error).
    plan = effective_plan(current_user)
    if plan == "free":
        used = await _uploads_this_month(current_user.id, session)
        if used >= FREE_MONTHLY_UPLOAD_CAP:
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail="upload_cap_reached",
            )

    fname_lower = (file.filename or "").lower()
    if (
        file.content_type not in ALLOWED_CONTENT_TYPES
        and not fname_lower.endswith(ALLOWED_EXTENSIONS)
    ):
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported file type: {file.content_type}. Upload a PDF, CSV or XLSX.",
        )

    contents = await file.read()

    if len(contents) > MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File too large: {len(contents) / 1024 / 1024:.1f} MB. Maximum is 10 MB.",
        )

    if len(contents) == 0:
        raise HTTPException(
            status_code=422,
            detail="Uploaded file is empty.",
        )

    job_id = str(uuid.uuid4())
    filename = file.filename or "unknown"

    logger.info(
        "Upload started — job_id=%s user_id=%s filename=%r content_type=%r size=%d bytes",
        job_id, current_user.id, filename, file.content_type, len(contents),
    )

    # Never let a corrupt/encrypted/unsupported file surface as a raw 500 — parse
    # failures come back as a structured failed/empty response the user can act on.
    try:
        # Vision PDF extraction is a paid feature; free users fall back to OCR.
        parse_result = parse_statement(
            contents, file.content_type, filename,
            allow_vision=vision_enabled(current_user),
        )
    except Exception as exc:
        logger.exception("Unexpected parse failure — job_id=%s: %s", job_id, exc)
        return UploadResponse(
            job_id=job_id, filename=filename, transaction_count=0,
            status="failed", reason="parse_error",
            message="Could not process the file.",
        )

    logger.info(
        "Parse complete — job_id=%s status=%s reason=%s raw_transactions=%d",
        job_id, parse_result.status, parse_result.reason, len(parse_result.transactions),
    )

    if not parse_result.transactions:
        # Distinguish a clean-but-empty parse from an actual failure so the frontend
        # can show an honest, actionable message instead of a green "0 success".
        status_str = parse_result.status if parse_result.status in ("empty", "failed") else "empty"
        return UploadResponse(
            job_id=job_id,
            filename=filename,
            transaction_count=0,
            status=status_str,
            reason=parse_result.reason or "unrecognized_format",
            message="No transactions were extracted from this file.",
        )

    # Currency the file actually revealed — None means the file had no currency marker,
    # so the value we stamp is only an inferred fallback the user must confirm in review.
    currency_detected = parse_result.detected_currency is not None
    default_ccy = parse_result.detected_currency or (current_user.display_currency or "TRY")
    persisted = await insert_transactions(
        parse_result.transactions, current_user.id, session,
        upload_batch_id=job_id, default_currency=default_ccy,
    )

    llm_available = len(settings.DEEPSEEK_API_KEY) > 0 or len(settings.OPENAI_API_KEY) > 0
    if llm_available:
        provider = get_provider(task_type="categorize")
        await categorize_batch(persisted, provider)
    else:
        logger.info("No LLM key configured — skipping categorization for job_id=%s", job_id)

    await bust_progress_cache(current_user.id, session)

    # Net-worth "bank balance" suggestions used to be derived here from a hardcoded
    # list of Turkish bank names — not global and semantically weak (statement net
    # flow ≠ account balance). Removed for global readiness; the field stays in the
    # response (empty) for backward compatibility.

    # The one conflict that matters: did the user upload this same statement twice?
    await _flag_duplicate_batch(current_user.id, job_id, persisted, session)

    # Parsed totals (real money) for the statement period — drives the onboarding
    # "we saw X income, Y expenses" line and downstream conflict checks.
    parsed_income = sum(
        (t.amount for t in persisted if t.transaction_type == "credit"), Decimal("0")
    )
    parsed_expenses = sum(
        (t.amount for t in persisted if t.transaction_type == "debit"), Decimal("0")
    )

    await session.commit()

    logger.info("Upload complete — job_id=%s transactions_persisted=%d", job_id, len(persisted))

    msg = f"Processed {len(persisted)} transactions successfully."
    if not llm_available:
        msg += " (No LLM key — categories not assigned.)"

    suggestion_out: list[SuggestionOut] = []

    return UploadResponse(
        job_id=job_id,
        filename=filename,
        transaction_count=len(persisted),
        status="success",
        reason=None,
        message=msg,
        suggestions=suggestion_out,
        parsed_income=str(parsed_income),
        parsed_expenses=str(parsed_expenses),
        currency=default_ccy,
        currency_detected=currency_detected,
    )


# ── Post-Upload Brief ────────────────────────────────────────────────────────
# The narrative read of one statement. Replaces the bare dashboard redirect with a
# 60–90s story. Cached per (job_id, lang) so the same statement always returns the
# same brief (cheap LLM amortisation; the brief is otherwise deterministic).

_BRIEF_DATA_TYPE = "brief"


class BriefPeriod(BaseModel):
    start: str
    end: str
    transaction_count: int


class BriefFlow(BaseModel):
    income: float
    expenses: float
    net: float
    currency: str


class BriefCategory(BaseModel):
    name: str       # category slug — frontend maps to a localized label
    amount: float
    share: float    # percent of total spend


class BriefLargest(BaseModel):
    description: str
    amount: float
    type: str


class BriefRecurring(BaseModel):
    monthly_total: float
    highlight: str | None = None


class BriefAction(BaseModel):
    key: str
    label: str
    href: str


class BriefResponse(BaseModel):
    job_id: str
    period: BriefPeriod
    flow: BriefFlow
    top_categories: list[BriefCategory] = []
    largest_transaction: BriefLargest | None = None
    recurring_signal: BriefRecurring
    suggested_action: BriefAction
    narrative: str | None = None


async def _brief_cache_get(
    user_id: uuid.UUID, expected_key: str, session: AsyncSession
) -> str | None:
    result = await session.execute(
        select(ProgressInsight).where(
            ProgressInsight.user_id == user_id,
            ProgressInsight.data_type == _BRIEF_DATA_TYPE,
        )
    )
    row = result.scalar_one_or_none()
    if row is None or row.cache_key != expected_key:
        return None
    return row.data


async def _brief_cache_set(
    user_id: uuid.UUID, cache_key: str, data: str, session: AsyncSession
) -> None:
    stmt = (
        pg_insert(ProgressInsight)
        .values(
            id=uuid.uuid4(),
            user_id=user_id,
            data_type=_BRIEF_DATA_TYPE,
            cache_key=cache_key,
            data=data,
            generated_at=datetime.now(timezone.utc),
        )
        .on_conflict_do_update(
            constraint="uq_progress_insights_user_type",
            set_={
                "cache_key": cache_key,
                "data": data,
                "generated_at": datetime.now(timezone.utc),
            },
        )
    )
    await session.execute(stmt)


@router.get("/brief", response_model=BriefResponse)
async def upload_brief(
    job_id: str,
    lang: str = "tr",
    current_user: User = Depends(get_verified_user),
    session: AsyncSession = Depends(get_session),
) -> BriefResponse:
    """
    WHAT: Returns the structured Post-Upload Brief for one upload batch.
    WHY: GET (read-only, idempotent) so the /brief page can deep-link / refresh.
         404 when the batch has no transactions — the frontend then silently
         falls back to /transactions.
    """
    cache_key = f"{job_id}|{lang}"
    cached = await _brief_cache_get(current_user.id, cache_key, session)
    if cached is not None:
        logger.info("Brief cache hit — user=%s job_id=%s", current_user.id, job_id)
        return BriefResponse.model_validate_json(cached)

    brief = await build_brief(job_id, current_user.id, session, lang=lang)
    if brief is None:
        raise HTTPException(status_code=404, detail="No brief available for this upload.")

    response = BriefResponse(**brief)
    await _brief_cache_set(current_user.id, cache_key, response.model_dump_json(), session)
    await session.commit()
    return response


# ── Review & edit a parsed batch before it becomes "truth" ───────────────────
# Lets the user inspect/correct extracted transactions before the brief narrates
# them. Catches parse errors (wrong amount, bad sign, duplicate) up front so the
# brief never confidently presents garbage as fact.


class ReviewTransaction(BaseModel):
    """One row in the review table. `id` absent → a new manual row to insert."""
    id: str | None = None
    transaction_date: date
    description: str
    amount: str
    transaction_type: str
    category: str | None = None
    currency: str = "TRY"

    @field_validator("transaction_type")
    @classmethod
    def _valid_type(cls, v: str) -> str:
        if v not in ("debit", "credit"):
            raise ValueError("transaction_type must be 'debit' or 'credit'")
        return v

    @field_validator("category")
    @classmethod
    def _valid_category(cls, v: str | None) -> str | None:
        if v is not None and v != "" and v not in _VALID_CATEGORIES:
            raise ValueError(f"Invalid category: {v}")
        return v or None

    @field_validator("amount")
    @classmethod
    def _valid_amount(cls, v: str) -> str:
        try:
            val = Decimal(v.replace(",", "."))
        except (InvalidOperation, AttributeError):
            raise ValueError("amount must be a valid number")
        if val <= 0:
            raise ValueError("amount must be positive")
        return v

    @field_validator("description")
    @classmethod
    def _valid_description(cls, v: str) -> str:
        cleaned = (v or "").strip()
        if not cleaned:
            raise ValueError("description cannot be empty")
        return cleaned


class ReviewRequest(BaseModel):
    transactions: list[ReviewTransaction]


class ReviewTransactionOut(BaseModel):
    id: str
    transaction_date: date
    description: str
    amount: str
    transaction_type: str
    category: str | None
    currency: str


async def _fetch_batch_rows(
    batch_id: str, user_id: uuid.UUID, session: AsyncSession
) -> list[Transaction]:
    result = await session.execute(
        select(Transaction)
        .where(Transaction.user_id == user_id)
        .where(Transaction.upload_batch_id == batch_id)
        .order_by(Transaction.transaction_date.asc())
    )
    return list(result.scalars().all())


def _row_out(t: Transaction) -> ReviewTransactionOut:
    return ReviewTransactionOut(
        id=str(t.id),
        transaction_date=t.transaction_date,
        description=t.description,
        amount=str(t.amount),
        transaction_type=t.transaction_type,
        category=t.category,
        currency=t.currency,
    )


@router.get("/review/{batch_id}", response_model=list[ReviewTransactionOut])
async def get_review_batch(
    batch_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[ReviewTransactionOut]:
    """Current transactions for one upload batch, oldest-first, for the review table."""
    rows = await _fetch_batch_rows(batch_id, current_user.id, session)
    return [_row_out(t) for t in rows]


@router.patch("/review/{batch_id}", response_model=list[ReviewTransactionOut])
async def save_review_batch(
    batch_id: str,
    body: ReviewRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[ReviewTransactionOut]:
    """
    WHAT: Applies the user's review of a batch — updates edited rows, inserts new manual
          rows, deletes rows the user removed. Reviewed rows become source=user_confirmed.
    WHY: Ownership is enforced by only ever matching ids within the user's own batch; a
         forged id from another batch simply won't match and is ignored.
    BREAKS IF REMOVED: The /review page can't commit corrections before the brief.
    """
    existing = {str(t.id): t for t in await _fetch_batch_rows(batch_id, current_user.id, session)}

    # Currency for new rows: the batch's dominant currency, else the user's display ccy.
    if existing:
        from collections import Counter
        default_ccy = Counter(t.currency or "TRY" for t in existing.values()).most_common(1)[0][0]
    else:
        default_ccy = current_user.display_currency or "TRY"

    seen: set[str] = set()
    for item in body.transactions:
        amount = Decimal(item.amount.replace(",", "."))
        if item.id and item.id in existing:
            t = existing[item.id]
            t.transaction_date = item.transaction_date
            t.description = item.description
            t.amount = amount
            t.transaction_type = item.transaction_type
            t.category = item.category
            t.source = "user_confirmed"   # user has reviewed/corrected this row
            seen.add(item.id)
        elif not item.id:
            session.add(Transaction(
                user_id=current_user.id,
                upload_batch_id=batch_id,
                amount=amount,
                currency=item.currency or default_ccy,
                transaction_type=item.transaction_type,
                description=item.description,
                transaction_date=item.transaction_date,
                category=item.category,
                source="user_confirmed",
            ))
        # id present but not owned → ignored

    # Rows the user removed from the table are deleted.
    for tid, t in existing.items():
        if tid not in seen:
            await session.delete(t)

    # Corrections change every downstream view — bust insight, progress AND the brief
    # cache (bust_progress_cache clears all ProgressInsight rows, incl. data_type=brief),
    # so the brief regenerates from the corrected data.
    await bust_insight_cache(current_user.id, session)
    await bust_progress_cache(current_user.id, session)
    await session.commit()

    logger.info(
        "Batch reviewed — user=%s batch_id=%s final_rows=%d",
        current_user.id, batch_id, len(body.transactions),
    )

    rows = await _fetch_batch_rows(batch_id, current_user.id, session)
    return [_row_out(t) for t in rows]
