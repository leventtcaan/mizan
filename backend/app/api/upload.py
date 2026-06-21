"""
WHAT: POST /upload endpoint — accepts a PDF or CSV bank statement, persists transactions,
      triggers LLM categorization, and returns a job_id with counts.
WHY: Decouples file receipt from display. The endpoint completes synchronously in Phase 2
     (parse + insert + categorize happen in-request); Phase 3 will move categorization
     to a background worker when volumes grow.
BREAKS IF REMOVED: No way for the frontend to submit bank statements.
"""

import uuid
import logging
from datetime import datetime, timezone
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_session
from app.core.dependencies import get_current_user
from app.core.rate_limiter import upload_ip_limiter, upload_user_limiter
from app.models.networth_suggestion import NetworthSuggestion
from app.models.user import User
from app.services.categorizer import categorize_batch
from app.services.llm_provider import get_provider
from app.services.pdf_parser import parse_statement
from app.services.transaction_service import bust_progress_cache, insert_transactions

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/upload", tags=["upload"])

MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024

ALLOWED_CONTENT_TYPES = {
    "application/pdf",
    "text/csv",
    "application/vnd.ms-excel",
}


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
    message: str
    suggestions: list[SuggestionOut] = []


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

    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported file type: {file.content_type}. Upload a PDF or CSV.",
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
        "Upload started — job_id=%s user_id=%s filename=%s size=%d bytes",
        job_id, current_user.id, filename, len(contents),
    )

    parse_result = parse_statement(contents, file.content_type, filename)
    logger.info("Parse complete — job_id=%s raw_transactions=%d", job_id, len(parse_result.transactions))

    if not parse_result.transactions:
        return UploadResponse(
            job_id=job_id,
            filename=filename,
            transaction_count=0,
            message="File parsed but no transactions were found. Check the file format.",
        )

    persisted = await insert_transactions(
        parse_result.transactions, current_user.id, session, upload_batch_id=job_id
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
        message=msg,
        suggestions=suggestion_out,
    )
