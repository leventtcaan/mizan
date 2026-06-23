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
from datetime import datetime, timezone
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_session
from app.core.dependencies import get_current_user
from app.core.rate_limiter import upload_ip_limiter, upload_user_limiter
from app.models.networth_suggestion import NetworthSuggestion
from app.models.progress_insight import ProgressInsight
from app.models.reconciliation_item import ReconciliationItem
from app.models.user import User
from app.services.brief import build_brief
from app.services.categorizer import categorize_batch
from app.services.llm_provider import get_provider
from app.services.pdf_parser import parse_statement
from app.services.conflict_detection import BatchInfo, find_duplicate_batch
from app.services.transaction_service import (
    bust_progress_cache,
    get_batch_summaries,
    insert_transactions,
)

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


# Keywords to detect bank names in transaction descriptions
_BANK_KEYWORDS = [
    "GARANTİ", "VAKIFBANK", "ZIRAAT", "YAPIKREDI", "HALKBANK",
    "AKBANK", "ISBANKASI", "QNB", "DENIZBANK", "ING",
]


async def _generate_networth_suggestions(
    user_id: uuid.UUID,
    batch_id: str,
    transactions: list,
    session: AsyncSession,
) -> list[NetworthSuggestion]:
    """
    Analyse transactions for bank account activity keywords.
    For each detected bank, compute net (credits - debits) and create a suggestion.
    """
    # Group by detected bank keyword
    bank_nets: dict[str, Decimal] = {}

    for tx in transactions:
        desc_upper = (tx.description or "").upper()
        for keyword in _BANK_KEYWORDS:
            if keyword in desc_upper:
                if keyword not in bank_nets:
                    bank_nets[keyword] = Decimal("0")
                amount = tx.amount if tx.amount else Decimal("0")
                if tx.transaction_type == "credit":
                    bank_nets[keyword] += amount
                else:
                    bank_nets[keyword] -= amount
                break  # only match first keyword per transaction

    suggestions: list[NetworthSuggestion] = []
    for bank_key, net in bank_nets.items():
        if net == 0:
            continue
        direction = "giriş" if net > 0 else "çıkış"
        reason = (
            f"{bank_key.title()} hesabında net {direction} tespit edildi: "
            f"{abs(net):.2f} TRY. "
            "Bu tutarı banka hesabı varlığınıza eklemek ister misiniz?"
        )
        suggestion = NetworthSuggestion(
            id=uuid.uuid4(),
            user_id=user_id,
            suggestion_type="balance_change",
            asset_id=None,
            suggested_change=net,
            currency="TRY",
            reason=reason,
            source_batch_id=batch_id,
            status="pending",
            created_at=datetime.now(timezone.utc),
        )
        session.add(suggestion)
        suggestions.append(suggestion)

    logger.info(
        "Networth suggestions generated — job_id=%s count=%d",
        batch_id, len(suggestions),
    )
    return suggestions


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


@router.post("", response_model=UploadResponse)
async def upload_statement(
    request: Request,
    file: Annotated[UploadFile, File(description="PDF or CSV bank statement")],
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> UploadResponse:
    """
    WHAT: Full upload pipeline — validate → parse → persist → categorize → commit.
    WHY: All steps run in one DB session so a categorization failure rolls back
         the insert (atomic: either all transactions land with categories or none do).
    BREAKS IF REMOVED: No way to submit bank statements; core app feature unavailable.
    """
    user_id_str = str(current_user.id)
    client_ip = request.client.host if request.client else "unknown"

    if not upload_user_limiter.is_allowed(user_id_str, max_calls=5, window_seconds=86400):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Günlük maksimum 5 yükleme hakkınızı kullandınız. Yarın tekrar deneyin.",
        )

    if not upload_ip_limiter.is_allowed(client_ip, max_calls=3, window_seconds=600):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="10 dakikada en fazla 3 yükleme yapılabilir. Lütfen bekleyin.",
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
        parse_result = parse_statement(contents, file.content_type, filename)
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

    # Generate net worth suggestions from transaction data (before commit)
    suggestions = await _generate_networth_suggestions(
        current_user.id, job_id, persisted, session
    )

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

    suggestion_out = [
        SuggestionOut(
            id=str(s.id),
            suggestion_type=s.suggestion_type,
            asset_id=str(s.asset_id) if s.asset_id else None,
            suggested_change=str(s.suggested_change),
            currency=s.currency,
            reason=s.reason,
            source_batch_id=s.source_batch_id,
            status=s.status,
            created_at=s.created_at,
        )
        for s in suggestions
    ]

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
    current_user: User = Depends(get_current_user),
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
